# Platform Admin Seed Design

**Date:** 2026-05-27
**Scope:** Extend `apps/auth-server/src/seed/seed.ts` to create 5 pre-provisioned platform admin users.
**Stack:** NestJS · PostgreSQL · Prisma · BetterAuth

---

## 1. Goal

Seed five platform admin users into the `Platform` org so a developer (or CI) has working credentials to exercise admin flows immediately after running `pnpm seed`. The seed must be re-runnable — if any of the users already exist, it skips them rather than failing or duplicating.

All five share the password `Pass@word1234` and live in the existing platform org (`isPlatform: true`).

---

## 2. Users

| Email | First | Last | Status | Permission grant |
|---|---|---|---|---|
| `u@sa.io` | Users | Admin | active | direct → `platform.users.manage` |
| `o@sa.io` | Orgs  | Admin | active | direct → `platform.orgs.manage` |
| `a@sa.io` | Apps  | Admin | active | direct → `platform.apps.manage` |
| `p@sa.io` | Perms | Admin | active | direct → `platform.permissions.manage` |
| `s@sa.io` | Super | Admin | active | role → `Platform Super Admin` (wraps all 4 `platform.*`) |

`emailVerified` is set to `true` for all five so they can sign in without a verification flow.

---

## 3. Grant mechanism

Two paths are used deliberately:

- **Users 1–4 (direct grants):** A single `SaUserPermission` row is inserted per user, pointing at the corresponding `SaPermission.id`. Matches the single-capability nature of each user with the minimum number of rows.
- **User 5 (role-based):** A `Platform Super Admin` role is created (idempotently) in the platform app and wired to all four `platform.*` permissions via `SaRolePermission`. The user is then attached via a `SaUserRole` row. Using a role here (rather than 4 direct grants) creates a reusable primitive: future super admins can be onboarded by assigning the same role.

`getEffectivePermissions` in `users.service.ts` already unions both tables, so admin tooling and the JWT issuance path see no difference.

---

## 4. Per-user creation flow

For each user, in this order:

1. **Idempotency check:** `prisma.user.findUnique({ where: { email } })`. If found, log "Already exists" and continue to the next user — no other writes.
2. **Create BetterAuth identity + password:** call `auth.api.signUpEmail({ body: { email, password: 'Pass@word1234', name: '<First> <Last>' } })`. This is the only sanctioned way to write a Better-Auth-compatible password hash — bypassing the API and hashing manually risks login failure if Better Auth changes its scrypt parameters.
3. **Mark verified:** update the resulting `User` row to `emailVerified: true` (signUpEmail leaves it `false`).
4. **Create `SaUser`:** in a transaction, write the row with a placeholder `publicId`, then update `publicId = sqids.encode([id])` — the same two-step pattern already used for `SaApp`, `SaOrg`, and `SaPermission` in this seed. Fields: `orgId = platformOrg.id`, `firstName`, `lastName`, `status: 'active'`, `betterAuthUserId` from step 2.
5. **Grant permission(s):**
   - Users 1–4: `prisma.saUserPermission.create({ data: { userId: saUser.id, permissionId: <looked-up>.id } })`.
   - User 5: ensure the `Platform Super Admin` role exists (see §5), then `prisma.saUserRole.create({ data: { userId: saUser.id, roleId: superRole.id } })`.

Any error in steps 2–5 aborts the whole script — the seed treats partial-user state as a bug, not a recoverable condition. (A partial user on first run would be cleaned up by `prisma migrate reset` or by deleting the offending `User` row.)

---

## 5. `Platform Super Admin` role

Created idempotently before user 5 is processed:

1. `findFirst({ where: { name: 'Platform Super Admin', appId: platformApp.id } })`.
2. If absent: two-step create-then-update for `publicId` (same sqids pattern), `appId = platformApp.id`.
3. Wire permissions: for each of the 4 `platform.*` permissions, `saRolePermission.upsert` keyed on `(roleId, permissionId)` — `create` if missing, no-op if present. This makes the role's permission set self-healing on re-run.

The role is scoped to the platform app (`appId = platformApp.id`) so it never leaks into tenant role listings.

---

## 6. Where the code goes

Single file change: `apps/auth-server/src/seed/seed.ts`.

New top-of-file constant:

```ts
const PLATFORM_ADMINS = [
  { email: 'u@sa.io', firstName: 'Users', lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.users.manage' } },
  { email: 'o@sa.io', firstName: 'Orgs',  lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.orgs.manage' } },
  { email: 'a@sa.io', firstName: 'Apps',  lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.apps.manage' } },
  { email: 'p@sa.io', firstName: 'Perms', lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.permissions.manage' } },
  { email: 's@sa.io', firstName: 'Super', lastName: 'Admin', grant: { kind: 'role',   role: 'Platform Super Admin' } },
] as const;

const ADMIN_PASSWORD = 'Pass@word1234';
```

New section appended to `main()` after the existing permission-creation loop:

1. Ensure the `Platform Super Admin` role exists (§5).
2. For each entry in `PLATFORM_ADMINS`, run the per-user flow (§4).

The `auth` object is imported from `../auth/auth.config` so `auth.api.signUpEmail` is available without spinning up the HTTP server.

---

## 7. Trade-offs and explicit non-goals

- **No admin-creation API endpoint.** Seeding is the right channel for pre-provisioned platform staff.
- **Password is hard-coded, not env-driven.** This is dev-time tooling and the spec literally specified `Pass@word1234`. Making it configurable would add surface area without value.
- **No tests.** The existing seed has none; failure mode is "user can't sign in," which is caught the first time anyone tries.
- **No reconciliation if `Platform Super Admin` role exists but its permissions drift.** §5 uses `upsert` to add missing permissions but does not remove extras. If you later need to prune, do it via a one-off script or `prisma migrate reset`.
- **`emailVerified` is force-set to `true`.** This deliberately bypasses the verification flow for seeded admins; this is acceptable only because these are dev/CI accounts, not production credentials.

---

## 8. Acceptance criteria

After running `pnpm --filter @sassy-auth/auth-server seed`:

1. All five users can sign in via `POST /api/auth/sign-in/email` with their email + `Pass@word1234`.
2. `GET /api/users/:id/effective-permissions` for each user returns exactly the expected permission set:
   - `u@sa.io` → `['platform.users.manage']`
   - `o@sa.io` → `['platform.orgs.manage']`
   - `a@sa.io` → `['platform.apps.manage']`
   - `p@sa.io` → `['platform.permissions.manage']`
   - `s@sa.io` → all 4 `platform.*` permissions
3. Re-running the seed produces no errors and no duplicate users / role / permissions.
