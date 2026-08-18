# Platform Admin Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `apps/auth-server/src/seed/seed.ts` so `pnpm seed` provisions 5 platform admin users with pre-set passwords and the permission grants specified in `docs/superpowers/specs/2026-05-27-platform-admin-seed-design.md`.

**Architecture:** Single-file change. A new constant table describes the 5 admins; a new `ensurePlatformSuperAdminRole` helper creates the reusable role; a new `seedPlatformAdmin` helper handles per-user creation idempotently. `main()` is extended to call them after the existing permission-seeding loop. All BetterAuth identity writes go through `auth.api.signUpEmail` so the password hash stays format-compatible with the live sign-in path.

**Tech Stack:** TypeScript · NestJS auth-server seed (`ts-node`) · Prisma · BetterAuth 1.6.11 · Sqids · PostgreSQL

---

## Prerequisites

Before starting any task, confirm the local dev environment is ready:

- [ ] **Step 0a: Database is up and migrated**

Run: `pnpm --filter @sassy-auth/db prisma migrate status`
Expected: "Database schema is up to date!" (or run `pnpm --filter @sassy-auth/db prisma migrate dev` if not).

- [ ] **Step 0b: Existing seed runs cleanly**

Run: `pnpm --filter @sassy-auth/auth-server seed`
Expected output ends with `Seed complete.` and contains lines like `Created platform app:`, `Created platform org:` (or `... already exists:` if previously run).

If either of these fails, fix the env before touching the seed file.

---

## File Structure

Only one source file is modified:

- **Modify:** `apps/auth-server/src/seed/seed.ts` — adds constants, two helper functions, and a new section in `main()`.

No new files. No schema changes. No service changes. No tests (the existing seed has none; failure mode is "user can't sign in," which is caught by the manual sign-in check in Task 4).

---

## Task 1: Add imports and admin table

**Files:**
- Modify: `apps/auth-server/src/seed/seed.ts` (top of file)

- [ ] **Step 1.1: Add the `auth` import**

Open `apps/auth-server/src/seed/seed.ts`. Below the existing `import Sqids from 'sqids';` line, add:

```ts
import { auth } from '../auth/auth.config';
```

- [ ] **Step 1.2: Add the admin table and password constants**

Below the existing `PLATFORM_PERMISSIONS` array (after line 16), add:

```ts
const ADMIN_PASSWORD = 'Pass@word1234';

type AdminGrant =
  | { kind: 'direct'; permission: string }
  | { kind: 'role'; role: string };

const PLATFORM_ADMINS: ReadonlyArray<{
  email: string;
  firstName: string;
  lastName: string;
  grant: AdminGrant;
}> = [
  { email: 'u@sa.io', firstName: 'Users', lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.users.manage' } },
  { email: 'o@sa.io', firstName: 'Orgs',  lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.orgs.manage' } },
  { email: 'a@sa.io', firstName: 'Apps',  lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.apps.manage' } },
  { email: 'p@sa.io', firstName: 'Perms', lastName: 'Admin', grant: { kind: 'direct', permission: 'platform.permissions.manage' } },
  { email: 's@sa.io', firstName: 'Super', lastName: 'Admin', grant: { kind: 'role',   role: 'Platform Super Admin' } },
];

const SUPER_ADMIN_ROLE_NAME = 'Platform Super Admin';
```

- [ ] **Step 1.3: Verify the seed still runs**

Run: `pnpm --filter @sassy-auth/auth-server seed`
Expected: same output as the baseline — `Seed complete.` at the end, no new behavior yet. The new constants are unused but must compile cleanly under `ts-node`.

- [ ] **Step 1.4: Commit**

```bash
git add apps/auth-server/src/seed/seed.ts
git commit -m "chore(seed): add platform admin table and auth import"
```

---

## Task 2: Add the `ensurePlatformSuperAdminRole` helper

**Files:**
- Modify: `apps/auth-server/src/seed/seed.ts` (add helper function above `main()`)

This helper creates the `Platform Super Admin` role if it does not exist and ensures it carries all 4 `platform.*` permissions. It is wired into `main()` in Task 3 — Task 2 only adds the function.

- [ ] **Step 2.1: Add the helper function**

In `apps/auth-server/src/seed/seed.ts`, insert above `async function main()` (line 18 in the current file):

```ts
async function ensurePlatformSuperAdminRole(platformAppId: number) {
  let role = await prisma.saRole.findFirst({
    where: { name: SUPER_ADMIN_ROLE_NAME, appId: platformAppId },
  });

  if (!role) {
    role = await prisma.$transaction(async (tx) => {
      const created = await tx.saRole.create({
        data: {
          publicId: 'placeholder',
          name: SUPER_ADMIN_ROLE_NAME,
          appId: platformAppId,
        },
      });
      const publicId = sqids.encode([created.id]);
      return tx.saRole.update({
        where: { id: created.id },
        data: { publicId },
      });
    });
    console.log(`Created role: ${SUPER_ADMIN_ROLE_NAME} (publicId=${role.publicId})`);
  } else {
    console.log(`Role already exists: ${SUPER_ADMIN_ROLE_NAME} (publicId=${role.publicId})`);
  }

  const platformPerms = await prisma.saPermission.findMany({
    where: { appId: platformAppId, name: { startsWith: 'platform.' } },
  });

  for (const perm of platformPerms) {
    await prisma.saRolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      create: { roleId: role.id, permissionId: perm.id },
      update: {},
    });
  }
  console.log(`Role ${SUPER_ADMIN_ROLE_NAME} wired to ${platformPerms.length} platform.* permission(s)`);

  return role;
}
```

- [ ] **Step 2.2: Verify it compiles (no behavior change yet)**

Run: `pnpm --filter @sassy-auth/auth-server seed`
Expected: same baseline output — `Seed complete.`, no new lines. The helper is defined but not called.

- [ ] **Step 2.3: Commit**

```bash
git add apps/auth-server/src/seed/seed.ts
git commit -m "chore(seed): add ensurePlatformSuperAdminRole helper"
```

---

## Task 3: Add the per-user seeding helper and wire `main()`

**Files:**
- Modify: `apps/auth-server/src/seed/seed.ts` (add helper + new section in `main()`)

- [ ] **Step 3.1: Add the per-user helper**

Insert above `async function main()`, after the `ensurePlatformSuperAdminRole` helper added in Task 2:

```ts
async function seedPlatformAdmin(
  admin: (typeof PLATFORM_ADMINS)[number],
  platformOrgId: number,
  superAdminRoleId: number,
) {
  const existing = await prisma.user.findUnique({ where: { email: admin.email } });
  if (existing) {
    console.log(`Admin already exists: ${admin.email}`);
    return;
  }

  const result = await auth.api.signUpEmail({
    body: {
      email: admin.email,
      password: ADMIN_PASSWORD,
      name: `${admin.firstName} ${admin.lastName}`,
    },
  });
  const baUserId: string = result.user.id;

  await prisma.user.update({
    where: { id: baUserId },
    data: { emailVerified: true },
  });

  const saUser = await prisma.$transaction(async (tx) => {
    const created = await tx.saUser.create({
      data: {
        publicId: 'placeholder',
        betterAuthUserId: baUserId,
        orgId: platformOrgId,
        firstName: admin.firstName,
        lastName: admin.lastName,
        status: 'active',
      },
    });
    const publicId = sqids.encode([created.id]);
    return tx.saUser.update({
      where: { id: created.id },
      data: { publicId },
    });
  });

  if (admin.grant.kind === 'direct') {
    const perm = await prisma.saPermission.findUnique({ where: { name: admin.grant.permission } });
    if (!perm) throw new Error(`Permission not found: ${admin.grant.permission}`);
    await prisma.saUserPermission.create({
      data: { userId: saUser.id, permissionId: perm.id },
    });
    console.log(`Created admin ${admin.email} with direct permission ${admin.grant.permission}`);
  } else {
    await prisma.saUserRole.create({
      data: { userId: saUser.id, roleId: superAdminRoleId },
    });
    console.log(`Created admin ${admin.email} with role ${admin.grant.role}`);
  }
}
```

- [ ] **Step 3.2: Wire the new section into `main()`**

In `main()`, locate the closing brace of the permission-creation loop (currently around line 82, immediately before `console.log('Seed complete.');`). Insert:

```ts
  // 4. Platform Super Admin role
  const superAdminRole = await ensurePlatformSuperAdminRole(platformApp.id);

  // 5. Platform admin users
  for (const admin of PLATFORM_ADMINS) {
    await seedPlatformAdmin(admin, platformOrg.id, superAdminRole.id);
  }
```

The `Seed complete.` line stays as the last log.

- [ ] **Step 3.3: Run the seed on a clean slate**

If your DB already has the SassyAuth tables populated and you want a clean run, reset first:

```bash
pnpm --filter @sassy-auth/db prisma migrate reset --skip-seed --force
```

Then run:

```bash
pnpm --filter @sassy-auth/auth-server seed
```

Expected output (order may vary slightly):

```
Seeding platform data...
Created platform app: id=..., publicId=...
Created platform org: id=..., publicId=...
Created permission: platform.orgs.manage
Created permission: platform.apps.manage
Created permission: platform.users.manage
Created permission: platform.permissions.manage
Created permission: org.users.manage
Created permission: org.permissions.manage
Created role: Platform Super Admin (publicId=...)
Role Platform Super Admin wired to 4 platform.* permission(s)
Created admin u@sa.io with direct permission platform.users.manage
Created admin o@sa.io with direct permission platform.orgs.manage
Created admin a@sa.io with direct permission platform.apps.manage
Created admin p@sa.io with direct permission platform.permissions.manage
Created admin s@sa.io with role Platform Super Admin
Seed complete.
```

- [ ] **Step 3.4: Verify idempotency**

Run the seed a second time without resetting the DB:

```bash
pnpm --filter @sassy-auth/auth-server seed
```

Expected: every `Created ...` line from the first run is replaced by `... already exists:` or equivalent. Specifically:

```
Platform app already exists: publicId=...
Platform org already exists: publicId=...
Role already exists: Platform Super Admin (publicId=...)
Role Platform Super Admin wired to 4 platform.* permission(s)
Admin already exists: u@sa.io
Admin already exists: o@sa.io
Admin already exists: a@sa.io
Admin already exists: p@sa.io
Admin already exists: s@sa.io
Seed complete.
```

No errors. No duplicate rows (verify with `psql -c "SELECT email FROM \"User\" WHERE email LIKE '%@sa.io';"` — should return exactly 5 rows).

- [ ] **Step 3.5: Commit**

```bash
git add apps/auth-server/src/seed/seed.ts
git commit -m "feat(seed): provision 5 platform admin users with permissions"
```

---

## Task 4: Verify acceptance criteria end-to-end

**Files:** none modified — verification only.

This task confirms the three acceptance criteria from spec §8 by hitting the running auth server. If any check fails, the bug is in Task 3 — fix and re-commit; do not patch over with a separate commit.

- [ ] **Step 4.1: Start the auth server**

In one terminal:

```bash
pnpm --filter @sassy-auth/auth-server start
```

Wait for `Auth server listening on port 3000` in the log.

- [ ] **Step 4.2: Verify all 5 admins can sign in (acceptance #1)**

In a second terminal, run:

```bash
for email in u@sa.io o@sa.io a@sa.io p@sa.io s@sa.io; do
  echo -n "$email -> "
  curl -s -o /dev/null -w '%{http_code}\n' \
    -X POST http://localhost:3000/api/auth/sign-in/email \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"Pass@word1234\"}"
done
```

Expected: every line prints `200`. Any `401` or `400` indicates the password hash or `emailVerified` was not set correctly — bug in Task 3, fix it.

- [ ] **Step 4.3: Verify effective permissions for each admin (acceptance #2)**

For each admin, you need their `SaUser.publicId` and a session cookie. The simplest path: re-use the sign-in response's `Set-Cookie` header and call `GET /api/users/:publicId/effective-permissions` while authenticated as a user with `platform.users.manage` (i.e., as `u@sa.io` or `s@sa.io`).

Convenience script — run from the repo root, requires `jq`:

```bash
# Sign in as the super admin to get a session cookie
COOKIE_JAR=$(mktemp)
curl -s -c "$COOKIE_JAR" \
  -X POST http://localhost:3000/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"s@sa.io","password":"Pass@word1234"}' > /dev/null

# Get the publicId of each admin and read their effective permissions
for email in u@sa.io o@sa.io a@sa.io p@sa.io s@sa.io; do
  PUBLIC_ID=$(psql "$DATABASE_URL" -At -c \
    "SELECT s.\"publicId\" FROM \"SaUser\" s JOIN \"User\" u ON u.id = s.\"betterAuthUserId\" WHERE u.email = '$email';")
  echo -n "$email ($PUBLIC_ID) -> "
  curl -s -b "$COOKIE_JAR" \
    "http://localhost:3000/api/users/$PUBLIC_ID/effective-permissions" | jq -c '.permissions'
done
rm "$COOKIE_JAR"
```

Expected output:

```
u@sa.io (...) -> ["platform.users.manage"]
o@sa.io (...) -> ["platform.orgs.manage"]
a@sa.io (...) -> ["platform.apps.manage"]
p@sa.io (...) -> ["platform.permissions.manage"]
s@sa.io (...) -> ["platform.apps.manage","platform.orgs.manage","platform.permissions.manage","platform.users.manage"]
```

(Arrays are alphabetically sorted per `getEffectivePermissions` in `users.service.ts`.)

If the `s@sa.io` line shows fewer than 4 permissions, the role wiring in `ensurePlatformSuperAdminRole` is broken. If any other line shows the wrong permission, the direct-grant branch in `seedPlatformAdmin` is broken.

- [ ] **Step 4.4: Stop the auth server**

Ctrl-C the terminal running `pnpm start`.

- [ ] **Step 4.5: Final sanity check — re-run the seed once more**

```bash
pnpm --filter @sassy-auth/auth-server seed
```

Expected: same idempotent output as Step 3.4. Confirms the seed is safe to keep in CI.

- [ ] **Step 4.6: No commit needed**

Task 4 is verification only. If you hit a failure here, fix Task 3's commit (amend or new commit, your call) rather than landing a verification-only commit.

---

## Self-Review (already performed by plan author)

**Spec coverage:**
- Spec §1 Goal → Task 3 (full seeding loop) + Task 4 (verification).
- Spec §2 Users table → Task 1 constant.
- Spec §3 Grant mechanism → Task 3 branching (`direct` vs `role`).
- Spec §4 Per-user flow steps 1–5 → Task 3.1 maps 1:1 to spec steps.
- Spec §5 Super Admin role → Task 2.
- Spec §6 Where the code goes → Tasks 1–3 (constants, helpers, `main()` wiring).
- Spec §7 Trade-offs → reflected in plan (no API endpoint, hard-coded password, no tests).
- Spec §8 Acceptance criteria → Task 4.

**Placeholder scan:** None — every code block is complete and every command has expected output.

**Type consistency:** `ADMIN_PASSWORD`, `PLATFORM_ADMINS`, `SUPER_ADMIN_ROLE_NAME`, `ensurePlatformSuperAdminRole`, `seedPlatformAdmin` are defined in Task 1/2/3 and referenced consistently in subsequent tasks. The `(typeof PLATFORM_ADMINS)[number]` indexed-access in `seedPlatformAdmin`'s signature lines up with the `ReadonlyArray<{...}>` shape declared in Task 1.2.
