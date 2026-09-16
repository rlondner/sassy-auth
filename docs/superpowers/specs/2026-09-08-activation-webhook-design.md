# Activation webhook + pending-account signup — design

**Date:** 2026-09-08
**Status:** approved design, no implementation plan yet
**Scope:** (a) an activation webhook a SaApp can register to be notified when
one of its users' `SaUser.status` transitions to `active`; (b) signup
authenticates and redirects the user immediately, while the account is still
`pending`/`unverified`; (c) `/userinfo` exposes account status instead of
hard-rejecting non-active users. Deactivation/other status-change webhooks are
explicitly out of scope for this design.

---

## 1. Problem and stance

Today `POST /api/register` (`registration.controller.ts:16-20`,
`registration.service.ts:42-154`) creates a `SaUser` with `status: 'unverified'`
and sends a verification email, but never authenticates the user — BetterAuth's
`autoSignIn: false` plus the unconditional session-creation gate
(`session-gate.ts`, wired via `auth.config.ts:128-153`) mean a freshly-registered
user cannot get a session or a token until they click the email link and become
`active`. There's also no way for a relying-party SaApp to learn *when* that
happens short of polling, and `/userinfo` (`token.controller.ts:793-821`)
currently throws `USER_NOT_FOUND` for any non-`active` user, so it can't be used
to check pending status either.

This design:

- Lets a SaApp register a webhook URL + secret; the auth-server calls it once
  when a user it owns transitions into `active` status, from any code path
  (email verification, invitation acceptance, admin action).
- Lets signup redirect the user back to the SaApp immediately with a working
  access token, before activation, by reusing the existing OAuth
  authorize-code/token-exchange machinery with a distinguishing marker — not by
  relaxing the session gate (which stays exactly as strict as it is today for
  every real login: password, OTP, social).
- Lets `/userinfo` report `status` instead of just erroring, for every status
  except `inactive` (a disabled account's token still doesn't work at all,
  matching today's behavior).

## 2. Data model

New nullable columns on `SaApp` (`schema.prisma:114-138`):

```prisma
model SaApp {
  // ...existing fields...
  webhookUrl    String?
  webhookSecret String?
}
```

One Prisma migration. No changes to `SaUser.status`'s enum
(`active | pending | inactive | unverified`, `schema.prisma:107-112`) or to any
other table. Webhook delivery attempts are logged to the existing
`SaAuditEvent` table (`schema.prisma:342-357`) using its generic `type` column
— no new table for delivery history, consistent with the fire-and-forget
decision in §5.

## 3. Signup: authenticate + redirect while pending

`RegistrationService.register` gains a step after the `SaUser` is created
(still `status: 'unverified'`) and the verification email is queued:

1. Resolve the SaApp's registered `login`-kind `SaAppRedirectUri`
   (`schema.prisma:140-150`) — the same lookup `/authorize` uses.
2. Insert a `SaOauthCode` row (`schema.prisma:294-313`) directly for the new
   user — no `/authorize` request, no BetterAuth session, no PKCE requirement
   beyond what the SaApp already registered for login. The row is marked
   `amr: '["signup"]'` instead of the normal `'["pwd"]'`/`'["otp"]'`/etc., so
   downstream code can recognize "this code was minted at signup, not from an
   authenticated session."
3. Respond the same way `/authorize` does today: redirect to
   `{redirectUri}?code={code}`.

The SaApp then calls `POST /api/token` with that code — the exact same request
shape as after a normal login — and gets back a normal access token. No new
client integration surface beyond handling a `pending`/`unverified` status from
`/userinfo` (§5).

## 4. Token exchange: allow redeeming a signup code for a non-active user

`POST /api/token`'s existing re-check of user status at redeem time
(`token.controller.ts:~463-490`, guarding against deactivation between
`/authorize` and `/token`) becomes status-and-amr aware:

- Code has `amr` containing `"signup"` → allow redeem when `SaUser.status` is
  `active`, `pending`, or `unverified`. Still reject `inactive`.
- Any other code (every real login) → unchanged: `active` only.

This is the only change to token-exchange authorization; nothing about normal
login codes' handling changes.

## 5. `/userinfo`: expose status instead of hard-rejecting

`token.controller.ts:~815` changes from:

```ts
if (saUser.status !== 'active') throw new UnauthorizedException(TokenErrorCode.USER_NOT_FOUND);
```

to:

```ts
if (saUser.status === 'inactive') throw new UnauthorizedException(TokenErrorCode.USER_NOT_FOUND);
```

and the response gains a `status` field:

```ts
return { sub: saUser.publicId, status: saUser.status, ...scopedClaims };
```

So a SaApp holding a signup-flow token sees
`{ sub, status: 'unverified', ... }`, and after activation,
`{ sub, status: 'active', ... }`. A disabled (`inactive`) account's token still
outright fails `/userinfo`, exactly as today — SaApps never see
`status: 'inactive'` from a live call, only from the webhook context is
"inactive" even a meaningful idea, and this design doesn't emit that (§6 is
activation-only).

## 6. Activation webhook

### 6.1 Trigger

Three code paths currently write `SaUser.status = 'active'` directly:
`auth.config.ts:348` (post-email-verification), `invitations.service.ts:110`
(invitation acceptance), and `users.service.ts` (admin PATCH). All three
switch to calling a new method instead of updating the column themselves:

```ts
class SaUserActivationService {
  async activate(saUserId: number): Promise<void> {
    const before = await this.prisma.saUser.findUnique({ where: { id: saUserId }, select: { status: true } });
    if (before?.status === 'active') return; // idempotent — no re-notify
    const saUser = await this.prisma.saUser.update({ where: { id: saUserId }, data: { status: 'active' } });
    await this.activationWebhookService.notifyActivation(saUser);
  }
}
```

Any future code path that activates a user is expected to call `activate()`
rather than writing `status: 'active'` directly — this is a convention, not an
automatically-enforced one (a Prisma-level extension was considered and
rejected as disproportionate machinery for a single-purpose feature; see
alternatives below).

### 6.2 Delivery

`ActivationWebhookService.notifyActivation(saUser)`:

1. Loads the `SaApp` owning `saUser`'s org; returns immediately (no-op) if
   `webhookUrl` is unset.
2. POSTs JSON:
   ```json
   { "event": "account.activated", "userId": "<saUser.publicId>", "appPublicId": "<...>", "activatedAt": "<ISO8601>" }
   ```
   with header `X-Sassy-Signature: sha256=<hex hmac>`, where the HMAC-SHA256 is
   computed over the raw JSON body using `SaApp.webhookSecret` — same
   verification shape as Stripe/GitHub webhooks, so existing client libraries'
   patterns apply.
3. 5s timeout; one retry on network error or 5xx response; no further
   backoff, no persistence of failed attempts beyond the audit log.
4. Every outcome (success, failure after retry, no-op for missing URL) is
   logged to `SaAuditEvent` (`type: 'activation_webhook_sent'` /
   `'activation_webhook_failed'`, with `saUserId`, `appPublicId`, `reason` on
   failure). Never throws — a webhook failure must never fail or roll back the
   activation itself.

### 6.3 Explicitly out of scope

- Deactivation or any other status-transition webhook.
- Webhook retry queues, backoff schedules, or delivery-attempt persistence
  beyond the audit log — if delivery fails, the SaApp's next `/userinfo` call
  reflects current status regardless.
- Per-app multiple webhook endpoints/event subscriptions (`SaAppWebhook` table)
  — one URL per app is sufficient for this feature.
- Collapsing `unverified`/`pending` or renaming `inactive` to `disabled` in the
  public API — all four internal status values are exposed as-is.

## 7. Testing

- `session-gate.spec.ts`-style unit tests for the amr-aware redeem check in
  token exchange: signup code + `pending`/`unverified` → succeeds;
  signup code + `inactive` → rejected; non-signup code + non-`active` →
  rejected (unchanged).
- `token.controller.spec.ts`: `/userinfo` returns `status` field for `active`
  and `pending`/`unverified`; still throws for `inactive`.
- `registration.service.spec.ts`: successful registration produces a
  `SaOauthCode` with `amr: '["signup"]'` and returns/redirects with a `code`
  param to the app's registered login redirect URI.
- New `activation-webhook.service.spec.ts`: signs correctly, no-ops when
  `webhookUrl` unset, retries once on failure, never throws on failure, logs
  both outcomes to `SaAuditEvent`.
- New `sa-user-activation.service.spec.ts`: idempotent (no double-fire when
  already `active`); all three existing call sites updated and covered.
