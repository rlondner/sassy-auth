# Refresh token support — design

**Date:** 2026-09-17
**Status:** approved design, no implementation plan yet
**Scope:** add OAuth 2.0 refresh tokens to sassy-auth's token issuance, for
both the `authorization_code` OAuth/OIDC flow (gated by a new `offline_access`
scope) and the `direct/login` password-login API (always issued). Refresh
tokens rotate on every use with reuse detection, and are revoked on logout and
on admin-side user deactivation.

---

## 1. Problem and stance

Today `TokenService.issueJwt` mints a single RS256 access token with a fixed
1-hour TTL (`apps/auth-server/src/token/token.service.ts:13`), and
`TokenController.oauthToken` only accepts `grant_type=authorization_code`
(`apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts:14`). There is no
way for a client to obtain a new access token without a full interactive
re-authentication (OAuth clients) or resubmitting credentials (`direct/login`)
every hour. This design adds a `refresh_token` grant so a client can silently
renew its access token, while keeping revocation and theft-detection
guarantees at least as strong as the existing single-use `SaOauthCode` model.

Design stance:
- Refresh tokens are **opaque, high-entropy random strings**, stored server-side
  as a SHA-256 hash only — never the plaintext — mirroring how client secrets
  and OAuth codes are already handled in this codebase.
- Refresh tokens **rotate on every use** (single-use, chained by a family id),
  with **reuse detection**: presenting an already-rotated token revokes the
  entire family. This is the current OAuth 2.0 Security BCP recommendation.
- `authorization_code` exchanges only receive a refresh token when the client
  requested and was granted the `offline_access` scope, and the app is
  configured to allow it. `direct/login` has no `/authorize` step, so it
  always receives a refresh token.
- Both confidential and public clients (PKCE-only) can receive refresh tokens.
  Client authentication rules for the `refresh_token` grant mirror
  `authorization_code` today: confidential clients (`clientSecretHash` set)
  must authenticate; public clients don't.

## 2. Data model

New table, modeled on `SaOauthCode` (`packages/db/schema.prisma:308-327`) —
DB-backed so multiple auth-server replicas share state, indexed for the
lookups rotation and revocation need:

```prisma
model SaRefreshToken {
  tokenHash           String    @id
  familyId            String
  saUserId            Int
  userPublicId        String
  orgPublicId         String
  appId               Int
  appPublicId         String
  scope               String
  amr                 String    // JSON array, same shape as SaOauthCode.amr
  idp                 String?
  createdAt           DateTime  @default(now())
  // Sliding window: reset to now()+30d on every successful rotation.
  expiresAt           DateTime
  // Fixed at family creation to now()+90d; never extended by rotation. Caps
  // how long a family can be kept alive by continual use.
  absoluteExpiresAt   DateTime
  revokedAt           DateTime?
  replacedByTokenHash String?

  @@index([familyId])
  @@index([saUserId])
  @@index([expiresAt])
}
```

`SaApp` gets one new field, following the existing `requireTwoFactor` opt-in
flag pattern (`packages/db/schema.prisma:122`):

```prisma
model SaApp {
  // ...existing fields...
  allowOfflineAccess Boolean @default(false)
}
```

## 3. Scope gating: `offline_access`

- `SUPPORTED_SCOPES` in `apps/auth-server/src/token/scopes.ts:3` gains
  `'offline_access'`.
- In `TokenController.oauthAuthorize`
  (`apps/auth-server/src/token/token.controller.ts:298-318`), after
  `parseScopes(scope)` runs, drop `offline_access` from the granted set unless
  `app.allowOfflineAccess` is true — same shape as the existing
  `isTwoFactorRequired(app)` gate a few lines above. The filtered scope string
  is what gets persisted via `generateCode(...)`, so `SaOauthCode.scope`
  already reflects the real grant and nothing downstream needs to re-check the
  app flag.
- `direct/login` never consults this flag; it always issues a refresh token
  (see §5).

## 4. Issuance and rotation

**`TokenService.issueRefreshToken(params)`** — new method, called wherever a
refresh token should be minted (first issuance) or rotated (subsequent use):

- First issuance: generates a new `familyId` (random hex), a new opaque token
  (`crypto.randomBytes(32).toString('hex')`, same style as
  `OauthService.generateCode`), inserts a `SaRefreshToken` row with
  `expiresAt = now + 30d` and `absoluteExpiresAt = now + 90d`, and returns the
  plaintext token to the caller.
- Rotation: same shape, but `familyId` and `absoluteExpiresAt` are carried
  over unchanged from the token being rotated; only `expiresAt` slides forward
  another 30 days.

**`TokenController.oauthToken`** gains a `grant_type=refresh_token` branch
(the DTO's `@IsIn(['authorization_code'])` becomes
`@IsIn(['authorization_code', 'refresh_token'])`, with `refresh_token` and
`code`/`redirect_uri`/`code_verifier` becoming mutually-exclusive-optional per
grant type). Flow for the new branch:

1. Hash the presented `refresh_token`, look up `SaRefreshToken` by
   `tokenHash`.
2. Not found → `invalid_grant` (`TokenErrorCode.INVALID_GRANT`).
3. `revokedAt` already set → **reuse detected**. Revoke every row sharing
   `familyId` (`updateMany({ where: { familyId }, data: { revokedAt: now } })`),
   log a warning (`oauth.refresh_token.reuse_detected`, no token values
   logged), and return `invalid_grant`.
4. `expiresAt` or `absoluteExpiresAt` in the past → `invalid_grant`.
5. Confidential-client check: if `SaApp.clientSecretHash` is set for
   `appId`, require and verify `client_secret`/Basic auth exactly as
   `oauthToken` already does for `authorization_code` — reuse
   `extractClientSecret`/`verifyClientSecret`.
6. Re-fetch the `SaUser` by `saUserId` and re-check `status === 'active'` —
   same guard as the code-exchange path, so a deactivation between issuance
   and refresh is honored immediately (belt-and-suspenders with §6's active
   revocation).
7. In one `prisma.$transaction`: mark the presented row `revokedAt = now`,
   `replacedByTokenHash = <new hash>`, and insert the new rotated row (§4,
   "Rotation").
8. Re-resolve permissions/roles via the existing
   `TokenService.resolvePermissions`/`resolveRoles` (so a permission change
   since last login is picked up) and call `issueJwt` for a fresh access
   token. If the family's `scope` includes `openid`, also call
   `issueIdToken`.
9. Response: `{ access_token, token_type: 'Bearer', expires_in: 3600, scope,
   refresh_token: <new plaintext>, ...(id_token) }` — same shape as the
   `authorization_code` response, with `refresh_token` added.

**Issuance on `authorization_code` exchange** — in `oauthToken`, alongside the
existing `grantedOpenId` check (`token.controller.ts:515`), add:

```ts
const grantedOffline = exchanged.scope.split(/\s+/).includes('offline_access');
```

and call `issueRefreshToken` (first issuance) only when `grantedOffline` is
true, including `refresh_token` in the response.

**Issuance on `direct/login`** — in `directLoginInner`
(`token.controller.ts:782-802`), always call `issueRefreshToken` alongside
`issueJwt` and include `refresh_token` in the returned body.

## 5. Revocation

**On logout** — `handleOauthLogout`
(`apps/auth-server/src/token/token.controller.ts:882-946`) already resolves
the token's `audience` (app) via `verifyAccessToken(idTokenHint)`. After the
existing `auth.api.signOut` call, add:

```ts
await prisma.saRefreshToken.updateMany({
  where: { userPublicId: claims.sub, appPublicId: audience, revokedAt: null },
  data: { revokedAt: new Date() },
});
```

placed after `audience` is resolved (so it only runs when `idTokenHint` was
valid — matching the existing scoping of that block). Logout without a valid
`id_token_hint` still terminates the BetterAuth session as today; it will not
revoke app-scoped refresh tokens because there's no way to identify which
app's tokens to target, which matches current behavior for that code path.

**On admin deactivation** — `UsersService`
(`apps/auth-server/src/users/users.service.ts:344-348`) already does:

```ts
if (dto.status === 'inactive') {
  await prisma.session.deleteMany({ where: { userId: existing.betterAuthUserId } });
}
```

Add, in the same block:

```ts
  await prisma.saRefreshToken.updateMany({
    where: { saUserId: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
```

This revokes all of the user's refresh tokens across every app, matching the
existing session-wipe's blast radius.

## 6. Admin console

`SaApp.allowOfflineAccess` needs an admin-facing toggle wherever
`requireTwoFactor` is currently surfaced on the app edit form. This design
does not enumerate the exact component (to be located during
implementation planning); the requirement is: an admin can view and flip
`allowOfflineAccess` per app, defaulting to off.

## 7. Error handling

All refresh failures — not found, already rotated (reuse), expired
(sliding or absolute), inactive user, failed client auth — collapse to
`invalid_grant` in the response, with the specific reason logged
server-side only (`this.logger.getWinstonLogger().warn(...)`), matching how
`SaOauthCode` exchange failures are already handled. No distinction is
observable to the client between these cases.

## 8. Testing

- `TokenService` unit tests: `issueRefreshToken` first-issuance shape,
  rotation carries `familyId`/`absoluteExpiresAt` forward and slides
  `expiresAt`, hash-only storage.
- `TokenController`/`OauthService` unit tests: successful rotation returns a
  new access+refresh token pair; reuse of an already-rotated token burns the
  whole family and further attempts (including the legitimately-next token in
  that family) fail; expired (sliding and absolute) tokens are rejected;
  confidential-client refresh without a valid secret is rejected;
  `offline_access` is dropped from granted scope when `allowOfflineAccess` is
  false, so no refresh token is issued on that code's exchange.
- `UsersService` unit test: deactivating a user revokes their outstanding
  `SaRefreshToken` rows.
- e2e: extend the existing OAuth e2e suite
  (`apps/auth-server` e2e tests referenced in `test-results/auth-server-e2e-*`)
  with a full authorize → code exchange with `offline_access` → refresh →
  rotated-refresh-reuse-rejected flow, and a `direct/login` → refresh flow.

## 9. Out of scope

- Refresh token support for any flow other than `authorization_code` and
  `direct/login` (there are no others today).
- A user-facing "active sessions/devices" list or per-device revocation UI —
  revocation here is all-or-nothing per app (logout) or per user
  (deactivation).
- Configurable refresh token lifetimes per app (30-day sliding / 90-day
  absolute are fixed platform constants, matching how `TOKEN_TTL_SECONDS` is
  a fixed constant today).
