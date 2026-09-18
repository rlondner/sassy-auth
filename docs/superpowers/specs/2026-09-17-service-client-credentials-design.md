# Service client credentials (`client_credentials` grant) — design

**Date:** 2026-09-17
**Status:** proposed design, no implementation plan yet
**Scope:** add an OAuth 2.0 `client_credentials` grant so a resource server's
own backend (e.g. VibeCast) can authenticate to sassy-auth as *itself* — no
end user in the loop — and call a narrow, purpose-built management endpoint
to assign/remove roles for its own users. Motivated by the subscription-tier
use case (Solo → Team upgrade in VibeCast's billing system must grant a
`VibeCast Team` role in sassy-auth), but the mechanism is general-purpose for
any app that needs server-to-server role management.

---

## 1. Problem and stance

Every mutation on `SaUser` roles today goes through `UsersController`
(`apps/auth-server/src/users/users.controller.ts:19-21`), which requires
**both**:
- `BetterAuthGuard` (`apps/auth-server/src/auth/better-auth.guard.ts`) — a
  human's `better-auth.session_token` **cookie**, scoped to the auth-server's
  own origin.
- `checkPermission(callerBaId, ['platform.users.manage', 'org.users.manage'], ...)`
  (`apps/auth-server/src/users/users.service.ts:309-313`) — resolved from
  `saUser.roles`/`directPermissions` for that cookie's human identity
  (`apps/auth-server/src/common/permissions/check-permission.ts:18-43`).

There is no credential a backend service can hold and present on its own
behalf: `OauthTokenExchangeDto.grant_type` only accepts `'authorization_code'`
(`apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts:10`), and every
existing flow (`authorization_code`, `direct/login`) ends with a token whose
`sub` is a specific end user. A billing webhook has no user in the loop and
must not impersonate one.

Design stance:
- New grant, `client_credentials` (RFC 6749 §4.4): a **confidential app only**
  (one with `clientSecretHash` set) authenticates with its existing client
  secret — the same credential and verification path already used for
  `authorization_code` (`client-auth.ts`'s `extractClientSecret`/
  `verifyClientSecret`, reused as-is in `token.controller.ts:420-421`). No new
  secret type, no new storage, no new rotation endpoint — `POST
  /api/apps/:publicId/client-secret` (`apps.controller.ts:44-46`) already
  rotates it.
- The token this grant mints is a **service token**, structurally distinct
  from a user access token: no `sub` naming an `SaUser`, a fixed short TTL,
  and a `scope` drawn from a *separate*, small, allowlisted vocabulary — not
  `SUPPORTED_SCOPES` (`token/scopes.ts:3`, which is OIDC identity scope and
  has no bearing on this).
- Scope is never self-granted by the caller. Whether an app may request
  `roles:write` at all is an explicit admin-configured flag on `SaApp` —
  mirrors the `allowOfflineAccess` gate in the refresh-token design
  (`docs/superpowers/specs/2026-09-17-refresh-tokens-design.md` §3) and the
  existing `requireTwoFactor` opt-in pattern (`schema.prisma:122`). Holding a
  valid client secret is necessary but not sufficient.
- The endpoint this token unlocks is **not** the general admin surface
  (`UsersController`). It is a new, narrow controller that only does role
  assign/remove, and only within the calling app's own boundary — never
  reachable via `checkPermission`'s broader `platform.users.manage`/
  `org.users.manage`, which a compromised service credential must not be able
  to reach.

## 2. Data model

One new field on `SaApp`, following the `allowOfflineAccess` /
`requireTwoFactor` boolean-opt-in shape:

```prisma
model SaApp {
  // ...existing fields...
  canManageOwnRoles Boolean @default(false)
}
```

No new table. Service tokens are stateless JWTs (like user access tokens) —
nothing to persist or rotate server-side beyond the client secret that's
already rotatable.

## 3. Scope vocabulary

New file `apps/auth-server/src/token/service-scopes.ts`, parallel to
`token/scopes.ts` but deliberately separate (these gate API capabilities, not
OIDC identity claims):

```ts
export const SUPPORTED_SERVICE_SCOPES = ['roles:write'] as const;
export type SupportedServiceScope = (typeof SUPPORTED_SERVICE_SCOPES)[number];
```

Single scope for now (`roles:write` — assign/remove roles for the app's own
users). Deliberately not reusing `platform.users.manage`/`org.users.manage`
naming: those are human-admin permission names resolved via
`SaRole`/`SaPermission`; this is a fundamentally different, app-level grant
that doesn't go through the permission tables at all.

## 4. Token exchange

**`OauthTokenExchangeDto`** (`token/dto/oauth-token-exchange.dto.ts`) gains a
`client_credentials` branch, same shape as the refresh-token design's
addition of `refresh_token` (mutually-exclusive-optional fields per grant
type):

```ts
@IsIn(['authorization_code', 'client_credentials'])
grant_type!: string;

// code / redirect_uri / code_verifier become conditionally required only
// for grant_type === 'authorization_code' (ValidateIf).

@IsOptional() @IsString()
scope?: string; // space-delimited, only meaningful for client_credentials
```

**`TokenController.oauthToken`** gains a `client_credentials` branch, entered
before the existing code-exchange logic:

1. Resolve `app` from `dto.client_id` exactly as today
   (`token.controller.ts:390-402`).
2. Reject if `app.clientSecretHash` is null — `client_credentials` is for
   confidential clients only; a public app has no secret to prove it's
   really VibeCast's backend and not anyone else. → `invalid_client`.
3. `verifyClientSecret(extractClientSecret(req, dto), app.clientSecretHash)`
   — same helper, same failure shape
   (`WWW-Authenticate: Basic`, `TokenErrorCode.INVALID_CLIENT`) as the
   existing confidential-client check at `token.controller.ts:429-436`.
4. `requested = parseServiceScopes(dto.scope)` (mirrors `parseScopes`,
   `token/scopes.ts:12-16`, but against `SUPPORTED_SERVICE_SCOPES`).
5. `granted = app.canManageOwnRoles ? requested : []` — same shape as the
   `allowOfflineAccess` gate in the refresh-token design (§3 there): the
   filtered, *actually granted* set is what gets embedded in the token, so
   nothing downstream needs to re-check the app flag.
6. `this.tokenService.issueServiceJwt({ appId: app.id, appPublicId: app.publicId, scope: granted.join(' ') })`.
7. Response: `{ access_token, token_type: 'Bearer', expires_in: 300, scope }`
   — no `refresh_token`, no `id_token`. A service token is minted on demand
   right before use; there's no held-open session to keep alive.

**`TokenService.issueServiceJwt`** — new method alongside `issueJwt`
(`token.service.ts:122-164`), distinct payload shape:

```ts
const payload = {
  // No `sub` — there is no end user. `azp` (authorized party, standard OIDC
  // claim name for "who authenticated") carries the calling app's identity
  // so downstream code has an unambiguous, differently-named field to check
  // instead of a user access token's `sub` — prevents a reviewer or future
  // guard from accidentally treating this as a user id.
  azp: params.appPublicId,
  aud: 'sassy-auth-management-api', // fixed constant, not the calling app's own aud
  iss: issuer,
  iat: now,
  exp: now + SERVICE_TOKEN_TTL_SECONDS, // 300s — short-lived, minted on demand
  scope: params.scope,
  token_use: 'service', // cheap, explicit discriminator; see §5
};
```

`aud: 'sassy-auth-management-api'` (not the app's own `publicId`, which is
what a user-token `aud` holds — `token.service.ts:139`) is deliberate: it
marks this token as "for calling sassy-auth's own API", not as an
audience-scoped credential the app would hand to something else, and it
means a user access token (whose `aud` is always some app's `publicId`) can
never accidentally satisfy the new guard's audience check.

## 5. The new endpoint and its guard

New controller, `apps/auth-server/src/service-users/service-users.controller.ts`,
mounted separately from `UsersController` — not an extra guard bolted onto
the existing one, a fully separate surface with a smaller blast radius:

```
PUT    /api/service/users/:userPublicId/roles/:rolePublicId
DELETE /api/service/users/:userPublicId/roles/:rolePublicId
```

(`PUT`/`DELETE` on a specific role, not the human-admin's
`AssignRoleDto`-with-body shape — there's no ambiguity to carry in a body for
a machine caller, and idempotent `PUT`/`DELETE` matches REST convention for
"this edge should exist / not exist".)

**`ServiceTokenGuard`** (new, parallel to `BetterAuthGuard`):

1. Extract `Authorization: Bearer <token>`, same parsing as the existing
   `/userinfo` handler (`token.controller.ts:812-816`).
2. `tokenService.verifyServiceAccessToken(raw)` — same `jwt.verify` call as
   `verifyAccessToken` (`token.service.ts:220-226`) but additionally asserts
   `token_use === 'service'` and `aud === 'sassy-auth-management-api'`. This
   is what makes the two token kinds non-interchangeable: a leaked user
   access token can't be replayed here (wrong `aud`), and a service token
   can't be replayed against a user-scoped endpoint (no `sub`, so
   `BetterAuthGuard`'s cookie check was never in play, but any other
   `verifyAccessToken`-based check keying on `sub` fails closed on
   `undefined`).
3. `scope.split(/\s+/).includes('roles:write')` — else `403 Forbidden`.
4. Attach `{ appId, appPublicId }` (from `azp`, resolved via
   `sqidService.decode`) onto the request for the controller/service to read
   — parallel to how `BetterAuthGuard` attaches `betterAuthUser`
   (`better-auth.guard.ts:20-21`).

**`ServiceUsersService.assignRole` / `.removeRole`** — the authorization
property that actually matters, checked in the service layer (not the
guard, which only proves *which app* is calling):

```ts
const user = await prisma.saUser.findUnique({
  where: { publicId: userPublicId },
  include: { org: true },
});
if (!user || user.org.appId !== callingAppId) throw new NotFoundException();

const role = await prisma.saRole.findUnique({ where: { publicId: rolePublicId } });
if (!role || role.appId !== callingAppId) throw new NotFoundException();

await prisma.saUserRole.upsert({ ... }); // idempotent, same P2002-swallow shape as UsersService.assignRole (users.service.ts:405-417)
```

Both checks — `user.org.appId === callingAppId` and `role.appId ===
callingAppId` — are required and independent. `SaOrg.appId`
(`schema.prisma:163`) is what ties a user to a single owning app; `SaRole` is
always app-scoped the same way (`schema.prisma:243`,
`token.service.ts:104`, "roles are always app-scoped"). Without both checks
VibeCast's service token could otherwise be used to assign a *VibeCast* role
to some *other* app's user, or vice versa. Returning `404` rather than `403`
for a cross-app target matches the existing "don't confirm existence you're
not authorized to know about" posture the rest of this codebase already
takes for cross-org access.

Deliberately **not** reusing `checkPermission`/`checkPermissionForApp`
(`common/permissions/check-permission*.ts`): both take a `betterAuthUserId`
and resolve permissions for a human identity. A service token has none —
its authorization is the app-boundary check above, not a permission lookup.

Note `assignRole`'s existing `assertCallerCanGrantSystemPerms` step
(`users.service.ts:403`, gates roles carrying `isSystem` permissions like
`org.users.manage`) has no service-token analogue here on purpose: a role
containing a system permission must still only ever be grantable by a human
admin through the existing path. If `VibeCast Team`'s role definition is
ever given a system permission, the app-boundary check above does not save
it — `ServiceUsersService.assignRole` should explicitly reject any role
carrying an `isSystem` permission, full stop, regardless of `callingAppId`.

## 6. Getting VibeCast a fresh token after the role change

Out of scope for *this* design (covered already), but the end-to-end shape
for the motivating use case:

1. VibeCast's billing webhook fires on Solo → Team upgrade.
2. VibeCast's backend calls `POST /api/token/oauth/token` with
   `grant_type=client_credentials` to get a service token (§4).
3. VibeCast's backend calls `PUT /api/service/users/:userPublicId/roles/:vibecastTeamRolePublicId`
   (§5) to assign the role.
4. VibeCast's frontend, still holding the user's live sassy-auth session
   cookie, drives a `prompt=none` re-authorization
   (`token.controller.ts:136-263`) to get a fresh user access token — this
   already exists and needs no new work. `resolvePermissions`/`resolveRoles`
   are recomputed on every `issueJwt` call (`token.service.ts:64-120`), so
   the new token reflects the just-assigned role immediately.

## 7. Error handling

Client-credentials failures collapse the same way `authorization_code`
failures do — `invalid_client` for a bad/missing secret or non-confidential
app, generic and indistinguishable across sub-reasons, logged server-side
only via `this.logger.getWinstonLogger().warn(...)` with an
`oauth.client_credentials.*` event name (mirrors `oauth.client_auth.failed`,
`token.controller.ts:431`). `ServiceTokenGuard` failures are plain
`401`/`403`; `ServiceUsersService` cross-app mismatches are `404` (§5).

## 8. Testing

- `TokenService` unit tests: `issueServiceJwt` payload shape (no `sub`,
  correct `aud`/`token_use`), TTL.
- `TokenController` unit tests: `client_credentials` rejected for a
  non-confidential app; rejected for a confidential app with
  `canManageOwnRoles: false` (scope comes back empty, so the guard later
  rejects for missing scope — verify both layers independently); accepted
  and scoped correctly when both conditions hold.
- `ServiceTokenGuard` unit tests: rejects a user access token (wrong `aud`/
  no `token_use`), rejects a service token missing `roles:write`.
- `ServiceUsersService` unit tests: assigns/removes successfully within the
  calling app's boundary; `404` when the target user belongs to a different
  app's org; `404` when the target role belongs to a different app;
  rejects (not merely 404s) a role carrying an `isSystem` permission
  regardless of app match.
- e2e: client_credentials exchange → service token → role assignment →
  `prompt=none` re-authorization returns a user token with the new role in
  its `roles` claim.

## 9. Out of scope

- Any scope beyond `roles:write` (e.g. a future `users:write` for
  provisioning/deprovisioning) — add to `SUPPORTED_SERVICE_SCOPES` when a
  concrete use case needs it, gated the same way.
- Per-role or per-scope granularity on `canManageOwnRoles` (e.g. "VibeCast
  may assign `VibeCast Team` but not `VibeCast Admin`") — the app-boundary
  check in §5 is the only granularity this design provides; a role-allowlist
  would be a straightforward follow-up if needed.
- Client-credentials support for public (non-confidential) apps — RFC 6749
  §4.4 assumes a confidential client by construction; a public app has no
  secret to present.
- An admin-console UI toggle for `canManageOwnRoles` — needed before this
  ships (same open item as `allowOfflineAccess` in the refresh-token design,
  §6 there), not designed here.
