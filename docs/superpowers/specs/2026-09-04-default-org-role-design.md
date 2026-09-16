# App-scoped default org & default role for self-serve sign-up — design

**Date:** 2026-09-04
**Status:** approved design, no implementation plan yet
**Scope:** let a `SaApp` declare an existing org (and/or an existing role) as
its default. Self-serve sign-up (`POST /api/register`, added by
`2026-09-03-admin-signup-design.md`) auto-joins the app's default org instead
of founding a new one, and/or auto-assigns the app's default role, and gates
first login behind email verification.

**Supersedes:** §5/§7 of `2026-09-03-admin-signup-design.md` explicitly
deferred email verification and org-joining as out of scope. This spec adds
both, scoped as described below.

---

## 1. Problem and stance

Today `RegistrationService.register()` (`registration.service.ts`) always
founds a **brand-new** `SaOrg` for every self-serve sign-up, and assigns the
new `SaUser` no role at all (`SaUserRole` is never touched). That's the right
default for a multi-tenant SaaS where every sign-up is a new customer, but
wrong for the "sign up on a resource server's own site" case: a visitor
arriving from an external app that already has one shared tenant (e.g. the
resource server's single organization) should join *that* org, not spin up
their own.

This spec adds two independent, optional per-app settings:

- **`SaApp.defaultOrgId`** — if set, self-serve sign-up on that app joins this
  existing org instead of creating a new one. `companyName` becomes irrelevant
  for that app.
- **`SaApp.defaultRoleId`** — if set, self-serve sign-up on that app also gets
  this role assigned, regardless of whether they joined the default org or
  founded a new one.

Both are independent switches; an app can set either, both, or neither (today's
behavior).

Because a self-serve default-org join is no longer "the visitor founds and
owns their own tenant," it also introduces an integrity requirement that
didn't matter before: proving the visitor actually controls the email address
they typed. **Every self-serve sign-up now requires email verification before
first login** (both the founder path and the default-org path — see §4 for why
this isn't scoped to default-org only).

## 2. Schema changes (`packages/db/schema.prisma`)

```prisma
model SaApp {
  // ...existing fields...
  defaultOrgId  Int?
  defaultOrg    SaOrg?  @relation("AppDefaultOrg", fields: [defaultOrgId], references: [id])
  defaultRoleId Int?
  defaultRole   SaRole? @relation("AppDefaultRole", fields: [defaultRoleId], references: [id])
}

model SaOrg {
  // ...existing fields...
  defaultForApps SaApp[] @relation("AppDefaultOrg")
}

model SaRole {
  // ...existing fields...
  defaultForApps SaApp[] @relation("AppDefaultRole")
}

enum UserStatus {
  active
  pending
  inactive
  unverified
}
```

Notes:

- Both FKs default to `Restrict` on delete (Prisma default, same as
  `SaOrg.appId`/`SaRole.appId` today) — deleting an org or role that's
  currently an app's default fails closed rather than silently orphaning the
  app setting.
- **Same-app invariant is enforced at the service layer, not the schema**:
  `defaultOrgId` must reference an org with `org.appId === app.id`, and
  `defaultRoleId` must reference a role with `role.appId === app.id`. Prisma
  can't express "this FK's target must share another FK's value" declaratively,
  so `apps.service.ts`'s update path validates this explicitly (400 if
  violated), the same way other cross-entity invariants in this codebase are
  enforced in the service layer rather than the schema (e.g. `checkPermission`'s
  org-scope check).
- `unverified` is a **new, 4th** status, distinct from `pending`. `pending`
  already has a specific, guarded meaning (`users.service.ts:314-324`,
  bug-0152): an invitation-created user with **no credential yet**, who can
  only become `active` by accepting the invite (admin PATCH is explicitly
  blocked from flipping it). `unverified` means the opposite shape of
  incompleteness — the user **has** a password, they just haven't clicked the
  email link yet. Reusing `pending` would either collide with bug-0152's guard
  or force weakening it; a distinct status keeps both guards independently
  correct and keeps `resendInvitation`'s `status !== 'pending'` check
  (`users.service.ts:622`) unaffected.
- The session gate (`session-gate.ts`) is unchanged — it already refuses a
  session unless `SaUser.status === 'active'`, so `unverified` is blocked for
  free, exactly like `pending`/`inactive` are today.

## 3. Registration flow (`registration.service.ts`)

**DTO** (`register.dto.ts`): `companyName` becomes `@IsOptional()`. Its
requiredness is now conditional on the resolved app, so it moves from
class-validator to a service-level check.

**`register()`**, after resolving `app` (step 1, unchanged):

```
if (app.defaultOrgId) {
  targetOrg = fetch SaOrg by app.defaultOrgId   // known to exist & belong to this app
} else {
  if (!dto.companyName?.trim()) throw BadRequestException('companyName is required')
  targetOrg = create new SaOrg as today
}
```

Inside the same transaction that creates the `SaUser`:

- `status: 'unverified'` (was `'active'`) — for **both** paths.
- If `app.defaultRoleId` is set, also create a `SaUserRole` row linking the
  new `SaUser` to it. This is unconditional on which org path was taken —
  a founder-path signup on an app with a `defaultRoleId` gets the role too
  (see §4 for why this isn't restricted to default-org joins).

After the transaction commits successfully, call
`auth.api.sendVerificationEmail({ body: { email: dto.email, callbackURL: '<ADMIN_URL>/signup/verified' } })`
explicitly from `RegistrationService`. This is **not** wired via BetterAuth's
global `emailVerification.sendOnSignUp` flag, because the seed scripts
(`seed.ts`, `demo-multitenant.ts`, `demo-resource-server.ts`) call
`auth.api.signUpEmail` directly and then set `emailVerified: true` themselves
— a global flag would fire real verification emails on every seed run.
Scoping the send to `RegistrationService` keeps seeds unaffected.

Everything else in `register()` — BetterAuth sign-up call, duplicate-email
detection via the synthetic-user check, compensation-on-failure (deleting the
orphaned BetterAuth user) — is unchanged.

## 4. Email verification (`auth.config.ts`)

New `emailVerification` block, following the existing `sendResetPassword`
callback pattern already in this file:

```ts
emailVerification: {
  sendVerificationEmail: async ({ user, url }) => {
    const firstName = (user.name ?? '').trim().split(' ')[0] || 'there';
    await getEmailer().send({ to: user.email, ...verifyEmailTemplate({ firstName, url }) });
  },
  afterEmailVerification: async (updatedUser) => {
    // No-op for any status other than 'unverified' — a user who is
    // 'pending' (invitation, no credential) or already 'active' verifying
    // an email through some other future path must not be silently promoted.
    await prisma.saUser.updateMany({
      where: { betterAuthUserId: updatedUser.id, status: 'unverified' },
      data: { status: 'active' },
    });
  },
  autoSignInAfterVerification: false, // consistent with autoSignIn: false elsewhere in this file
},
```

New template file `apps/auth-server/src/email/templates/verify-email.template.ts`,
following `password-reset.template.ts`'s shape.

This uses BetterAuth's built-in `/verify-email` endpoint and its stateless
signed-JWT token (confirmed in the installed `better-auth@1.6.11` —
`sendVerificationEmail`/`afterEmailVerification` are dedicated hook fields
read directly off `emailVerification`, distinct from the single `hooks.after`
matcher already documented at `auth.config.ts:195-201`; no new DB table or
change to that existing matcher is needed).

**Why this applies to the founder path too, not just default-org joins:**
the two are orthogonal concerns — email verification defends "did this person
actually type an email address they control" (relevant to *every* self-serve
signup, founder or not), while default-org/default-role are about *where a
verified person lands*. Scoping verification only to default-org joins would
leave the founder path exactly as unauthenticated as it is today while making
default-org joins strictly more annoying, for no security reason tied to org
topology.

## 5. Admin sign-in error surface (`login/actions.ts`)

An `unverified` user attempting to sign in still gets a 403 from the
(unchanged) session gate. Today `login/actions.ts` maps every 403 to a single
generic `inactive` error string (`res.status === 403 → { error: 'inactive' }`,
lines 236/381). Add a distinct `unverified` code so the login page can say
"check your email to verify your account" instead of the generic message —
requires the auth-server's sign-in error body to carry the `SaUser.status`
that caused the refusal (small addition; `evaluateSessionGate` already
computes and returns `status`, it's just not surfaced past the throw today).

## 6. Admin console

- **App edit drawer** (`app-edit-drawer.tsx`): two new optional selects,
  "Default organization" (populated from that app's existing orgs) and
  "Default role" (populated from that app's existing roles), alongside the
  existing `requireTwoFactor`/`twoFactorTrustDays` fields. **Not** on the
  create drawer — a brand-new app has no orgs or roles yet to choose from.
- **Users table / user detail**: `unverified` gets its own status badge,
  distinct from `pending`/`active`/`inactive`.
- **`updateUser`** (`users.service.ts`): add `unverified → active` to the set
  of admin-permitted status transitions (manual override for e.g. a visitor
  who lost the email). Deliberately does **not** touch the existing
  `pending → active` block (bug-0152) — that guard's reasoning doesn't apply
  to `unverified` users, who already have a credential.
- **Delete-org / delete-role error messages** (`orgs.service.ts:163-166`,
  `roles.service.ts:236-239`): both already catch `P2003` (FK violation) and
  report "has dependent users" / "assigned to N users". With the new
  `Restrict`-on-delete FKs, deleting an org or role that's an app's *default*
  (but has zero actual `SaUser`/`SaUserRole` rows) now also hits this same
  catch block, producing a misleading "assigned to 0 users" message. Both
  catch blocks should additionally check `prisma.saApp.findFirst({ where: {
  OR: [{ defaultOrgId: id }] } })` (respectively `defaultRoleId`) and report
  "is the default org/role for app <name>" when that's the actual cause.

## 7. Sign-up UI (`apps/admin/app/signup`)

- `GET /api/register/app` response gains `hasDefaultOrg: boolean` alongside
  the existing `name`.
- `SignupPage`/`SignupForm`: when `hasDefaultOrg` is true, hide the "Company
  name" field entirely and omit `companyName` from the `registerAction` payload
  (rather than sending an empty string).
- Success copy (`signup.success` in `messages/en.json`) changes from implying
  immediate readiness to log in, to explaining that a verification email was
  sent and must be clicked first. Applies regardless of `hasDefaultOrg`, since
  verification is required on both paths (§4).

## 8. What stays unchanged

- `REGISTER_RATE_LIMIT`/`REGISTER_RATE_WINDOW_MS`.
- Social/OTP signup stays disabled (`disableSignUp` on both) — unrelated.
- The session gate's core rule (`status === 'active'` required) — `unverified`
  is just a new value that fails it the same way `pending`/`inactive` do.
- `checkPermission`'s org-scoping logic — a default-role assignment is a
  normal `SaUserRole` row, nothing about permission evaluation changes.

## 9. Explicitly out of scope

- Per-app configurable *multiple* default roles, or org-scoped default role
  sets (e.g. "default role X for org A, role Y for org B" on the same app) —
  one `defaultRoleId` per app, full stop.
- A "resend verification email" self-service action on the login page (the
  admin-side manual `unverified → active` override in §6 covers the stuck
  case for now).
- Any change to how founder-path users are otherwise permissioned — a founder
  on an app with no `defaultRoleId` still gets zero roles, same as today; this
  spec doesn't add an implicit "org owner" role.
