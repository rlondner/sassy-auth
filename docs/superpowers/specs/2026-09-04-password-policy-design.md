# Configurable password complexity policy — design

**Date:** 2026-09-04
**Status:** approved design, no implementation plan yet
**Scope:** replace the hardcoded, triplicated 12-char/upper/lower/digit password
rule with a globally configurable policy (env-driven), overridable per `SaApp`,
enforced consistently across every surface that sets a user's password
(self-serve signup, accept-invite, forgot-password reset), and surfaced to the
end user as a live requirements checklist.

---

## 1. Problem and stance

Today password complexity is `/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$/`,
copy-pasted in four places with no shared source of truth:

- `register.dto.ts` (server, class-validator `@Matches`)
- `accept-invitation.dto.ts` (server, class-validator `@Matches`)
- `signup-form.tsx` and `accept-invite-form.tsx` and `reset-password-form.tsx`
  (client, inline regex, submit-time only)

Worse, **BetterAuth's own `/reset-password` endpoint has no server-side
length or complexity enforcement at all** — `emailAndPassword.minPasswordLength`/
`maxPasswordLength` are never set in `auth.config.ts`, so the forgot-password
flow's only gate is the client-side JS check in `reset-password-form.tsx`,
which a direct POST to the endpoint bypasses entirely.

This spec:

- Makes the policy's seven knobs (min length, require upper/lower/number/
  special, min-number-count, min-special-count) configurable via `.env`.
- Lets any `SaApp` fully override the global policy for its own users.
- Enforces the resolved policy identically across all three password-setting
  surfaces, closing the reset-password gap.
- Extracts one shared, pure validation function so client (live checklist)
  and server (enforcement) can never drift.

## 2. Shared policy type and pure evaluator (`packages/types`)

```ts
export interface PasswordPolicy {
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumber: boolean
  requireSpecial: boolean
  minNumbers: number   // only meaningful when requireNumber is true
  minSpecial: number   // only meaningful when requireSpecial is true
}

export type PasswordRuleKey =
  | 'minLength' | 'requireUppercase' | 'requireLowercase'
  | 'requireNumber' | 'requireSpecial' | 'minNumbers' | 'minSpecial'

export interface PasswordRuleResult { rule: PasswordRuleKey; met: boolean }

/** Pure, dependency-free. Evaluates every rule (does not short-circuit) so
 * callers can render/report every failure, not just the first. */
export function evaluatePasswordPolicy(
  password: string,
  policy: PasswordPolicy,
): PasswordRuleResult[]
```

A fixed, non-configurable `MAX_PASSWORD_LENGTH = 256` (DoS guard on the
scrypt hash step — mirrors the existing `bug-0184` rationale in
`accept-invitation.dto.ts`) lives as a constant next to this, applied
unconditionally on every surface regardless of policy override. Related fix
bundled in: `register.dto.ts` is missing this cap today (only
`accept-invitation.dto.ts` has it) — add it there too.

`apps/admin` and `apps/auth-server` both depend on `@sassy-auth/types`
already, so both import this file with no new package.

## 3. Global default policy (env-driven)

New env vars, parsed once in `apps/auth-server/src/auth/auth.config.ts`
(same pattern as the existing `TRUSTED_ORIGINS` parsing):

```
PASSWORD_MIN_LENGTH=12
PASSWORD_REQUIRE_UPPERCASE=true
PASSWORD_REQUIRE_LOWERCASE=true
PASSWORD_REQUIRE_NUMBER=true
PASSWORD_REQUIRE_SPECIAL=false
PASSWORD_MIN_NUMBERS=1
PASSWORD_MIN_SPECIAL=0
```

Defaults (when unset) reproduce today's exact behavior: 12/upper/lower/
number required, special not required, min-numbers 1, min-special 0 — this
change is behavior-neutral for every app that doesn't opt into an override.

Add these to every real `.env`/`.env.example` in the repo (`.env.example`,
`.env.local`, `apps/auth-server/.env`; **not** the `.worktrees/**` copies,
which are separate checkouts, and not `apps/resource-server-fastapi/.env*`,
which is a resource-server sample unrelated to the auth server's password
policy).

## 4. Per-app override (`packages/db/schema.prisma`)

```prisma
model SaApp {
  // ...existing fields...
  passwordPolicyOverride Json?
}
```

`null` = inherit the global policy entirely. Non-null = a complete
`PasswordPolicy` object (validated at write time, §6) that fully replaces
the global policy for that app's users. No partial/per-field override — an
app either uses the global policy or defines its own complete one, which
matches the UI's "override toggle" framing (§7) and avoids 7 new columns
plus per-field fallback resolution logic.

`resolvePasswordPolicy(app: { passwordPolicyOverride: unknown }): PasswordPolicy`
in `apps/auth-server/src/auth/password-policy.ts` returns the override if
present, else the global env-derived policy computed in §3.

## 5. Enforcement across the three surfaces

`validatePasswordOrThrow(password, policy)` (same file as §4) calls
`evaluatePasswordPolicy`, and if any rule fails throws:

```ts
throw new BadRequestException({
  errorKey: 'password.policyViolation',
  failedRules: ['minLength', 'requireSpecial'], // every failed rule, not just first
})
```

This matches the existing `errorKey`-mapping convention already used in the
admin app (e.g. `app-edit-drawer.tsx`'s `errorKey` state / `apps.errors.*`
i18n keys).

**Self-serve signup** (`POST /api/register`): `register.dto.ts`'s
`@Matches(PASSWORD_PATTERN)` is removed — the DTO keeps only
`@IsString() @MinLength(1) @MaxLength(256)`. `registration.service.ts`
resolves the app from `dto.appPublicId` (already required on the DTO),
calls `resolvePasswordPolicy(app)`, then `validatePasswordOrThrow`.

**Accept invitation**: same shape. `accept-invitation.dto.ts` loses its
`@Matches`. `invitations.service.ts`'s `acceptInvitation()` resolves the app
via `invitation.user.org.appId` (one extra `include` on the existing
`INVITATION_INCLUDE`) and validates before calling BetterAuth.
`validateToken()`'s response gains a `passwordPolicy` field so the
accept-invite page can render the live checklist (§7) before the user ever
submits.

**Forgot-password reset** (BetterAuth's `/reset-password`, gap-closer): add
a `hooks.before` matcher in `auth.config.ts`, following the existing
`hooks.after` matcher's pattern (task-8) but as a new `before` field (no
conflicting existing `hooks.before` block exists today):

```ts
hooks: {
  before: createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/reset-password') return
    const token = ctx.body?.token ?? ctx.query?.token
    const app = await resolveAppForResetToken(prisma, token) // may be null
    if (!app) return // let BetterAuth's own INVALID_TOKEN handling fire
    validatePasswordOrThrow(ctx.body.newPassword, resolvePasswordPolicy(app))
  }),
  after: /* unchanged, existing task-8 matcher */,
},
```

`resolveAppForResetToken` queries `Verification` by
`identifier: \`reset-password:${token}\`` (confirmed against installed
`better-auth@1.6.11`'s `password.mjs`: `value` on that row is the BetterAuth
user id), then `SaUser.findFirst({ betterAuthUserId: value })` → `org.appId`.
A missing/expired verification row returns `null` and defers to BetterAuth's
own token-validity check rather than duplicating it.

Also set BetterAuth's built-in top-level `password: { minPasswordLength,
maxPasswordLength }` from the global policy as a baseline — belt-and-braces
in case any future BetterAuth-native path sets a password without going
through this hook.

New public endpoint `GET /api/password-policy?resetToken=<token>` (auth-server)
resolves the same way and returns the effective `PasswordPolicy`, so
`reset-password-form.tsx` can fetch it for the live checklist. Returns the
**global** policy (not a 404) for an invalid/expired token, since the page
still needs *something* to render before the user's submit reveals the token
is bad — the submit-time `hooks.before` check is the actual enforcement
regardless of what the checklist showed.

## 6. Admin API (`PATCH /api/apps/:publicId`)

Extend the existing update-app DTO with an optional
`passwordPolicyOverride: PasswordPolicy | null`. New nested validation
(class-validator on a nested DTO, or a manual check in `apps.service.ts`
mirroring how other cross-field invariants in this codebase are enforced at
the service layer — see the `defaultOrgId`/`defaultRoleId` same-app check in
`2026-09-04-default-org-role-design.md`):

- `minLength` in `[8, 128]`.
- `minNumbers`, `minSpecial` are non-negative and each `<= minLength`.
- `null` clears the override (reverts the app to the global policy).

`GET` on an app (view drawer's data source) returns both the raw
`passwordPolicyOverride` (null or object) and a computed `effectivePolicy`,
so the UI can distinguish "inheriting" from "overridden with values that
happen to match the global default."

## 7. Admin console UI

**`app-edit-drawer.tsx`**: new collapsible section, "Password Policy,"
placed after the existing `requireTwoFactor` field, following that file's
existing `Label` + hint-paragraph visual language. Collapsed by default.

- Header is a toggle: "Override global password policy for this app."
- **Off**: section stays collapsed, shows the effective (global) policy as
  a read-only one-line summary (e.g. "12+ characters, upper/lower/number
  required").
- **On**: expands into the full field set — min length (number input), four
  checkboxes (require upper/lower/number/special), two number inputs
  (min numbers, min special), each numeric input disabled/greyed when its
  corresponding checkbox is off.
- Dirty-tracking and save follow the file's existing `patch` pattern: only
  include `passwordPolicyOverride` in the PATCH body if changed; toggling
  the override off sends `null`.
- **Not** added to `app-create-drawer.tsx` — a brand-new app starts on the
  global policy, same rationale as `2026-09-04-default-org-role-design.md`
  keeping default-org/default-role off the create drawer.

**Live requirements checklist**: new shared component
`apps/admin/components/password-requirements-checklist.tsx`, built on the
shared `evaluatePasswordPolicy`. Fetches/receives the effective policy for
its context (register: from the app-selection response; accept-invite: from
`validateToken()`; reset-password: from the new `GET /api/password-policy`
endpoint) and re-evaluates on every keystroke, rendering each rule as a
ticked/unticked list item. Replaces the three duplicated inline
`if (password.length < 12) ...` blocks in `signup-form.tsx`,
`accept-invite-form.tsx`, and `reset-password-form.tsx`.

## 8. i18n

Each `PasswordRuleKey` maps to an i18n message key under a new
`password.rules.*` namespace (e.g. `password.rules.minLength`,
`password.rules.requireSpecial`), added to `en.json`/`fr.json`. The
checklist labels and the server's `failedRules`-derived error summary both
read from this same namespace, so wording can never drift between "what you
see while typing" and "what the server rejected you for."

## 9. Testing

- Unit tests for `evaluatePasswordPolicy` (exhaustive rule combinations,
  boundary lengths) and `resolvePasswordPolicy` (global fallback vs.
  override) — new, colocated with `password-policy.ts`.
- `registration.service.spec.ts` / `invitations.service.spec.ts`: replace
  static-regex assertions with policy-driven ones; add an app-override case.
- `auth.config.spec.ts`: new case for the `hooks.before` reset-password
  interception (file already has patterns for testing hooks on this config).
- Admin API tests for `PATCH /api/apps/:publicId` with
  `passwordPolicyOverride` (set, clear, out-of-bounds values rejected).
- Component tests: new checklist component; `app-edit-drawer.test.tsx`
  extended for the new section's toggle/dirty/save behavior.
- E2E: extend `signup.spec.ts` (or a new spec) to prove an app-level
  override actually changes what password is accepted at signup — the one
  behavior here that's worth watching happen end-to-end rather than only
  unit-testing.

## 10. What stays unchanged

- `resetPasswordTokenExpiresIn`, `revokeSessionsOnPasswordReset`, and every
  other existing `emailAndPassword` setting in `auth.config.ts`.
- `REGISTER_RATE_LIMIT`/rate limiting generally — unrelated to password
  content.
- Social/OTP/2FA flows — none of them set a new plaintext password.

## 11. Explicitly out of scope

- Per-field override granularity (mix-and-match knobs) — all-or-nothing per
  app only (§4).
- Password history / reuse prevention, breach-list checking (e.g.
  Have I Been Pwned), or password expiry — none of that was requested; this
  spec is complexity-shape only.
- A "change password while logged in" flow — no such surface exists today
  (`account/security` only handles 2FA); out of scope until one exists.
- Configurable `MAX_PASSWORD_LENGTH` — stays a fixed 256-char security floor,
  not a policy knob (§2).
