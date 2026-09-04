# Prisma 5 → 7 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `packages/db` (and every consumer of `@sassy-auth/db`) from Prisma `^5.14.0` to Prisma `^7.x`, landing as two independently-shippable phases (5→6, then 6→7), with the full existing test suite plus a real-Postgres e2e run as the regression gate at each phase.

**Architecture:** No schema redesign — this is a dependency/runtime upgrade. Phase A (v5→v6) is a version bump plus an isolated migration for the implicit-relation-table primary-key change (verified not to trigger for our schema, but the step is kept as a safety net). Phase B (v6→v7) is the substantial one: switch the generator from `prisma-client-js` to `prisma-client` with `moduleFormat = "cjs"` (keeps the whole CommonJS/NestJS/ts-jest toolchain untouched), introduce a mandatory `@prisma/adapter-pg` driver adapter in the `PrismaClient` constructor, and add `packages/db/prisma.config.ts` to replace the CLI's now-removed implicit env/schema resolution.

**Tech Stack:** Prisma ORM, `@prisma/client`, `@prisma/adapter-pg`, `pg`, PostgreSQL 16, NestJS (`apps/auth-server`), Next.js (`apps/admin`), Jest/ts-jest, Playwright (`apps/admin-e2e`), Docker, GitHub Actions.

---

## File Structure

- Modify: `packages/db/schema.prisma` — generator block only (`provider`, `output`, `moduleFormat`)
- Modify: `packages/db/package.json` — dependency versions
- Modify: `packages/db/index.ts` — client construction (driver adapter) + import path
- Modify: `packages/db/two-factor-fields.spec.ts` — import path
- Create: `packages/db/prisma.config.ts` — CLI config (schema path, migrations path, datasource URL)
- Modify: `.gitignore` — ignore the new generated-client output directory
- Modify: `docker/Dockerfile.auth-server` — copy `prisma.config.ts` into the `deps` stage
- Modify: `.github/workflows/e2e.yml` — drop the now-removed `--schema=schema.prisma` CLI flag
- No changes needed: `docker/entrypoint-auth-server-prod.sh` (`prisma migrate deploy` command is unchanged in v7), `apps/auth-server/**`, `apps/admin/**` (both consume Prisma only via `@sassy-auth/db`'s re-exports)

---

## Phase A: Prisma 5 → 6

### Task 1: Baseline and version bump

**Files:**
- Modify: `packages/db/package.json:28,35`

- [ ] **Step 1: Confirm the working tree is clean and record the baseline**

```bash
git status --porcelain
git log -1 --oneline
```
Expected: no uncommitted changes reported (the plan should start from a clean `dev`). Note the commit hash somewhere so a bad phase can be bisected against it.

- [ ] **Step 2: Run the full existing test suite to capture a pre-migration baseline**

```bash
pnpm --filter @sassy-auth/db test
pnpm --filter @sassy-auth/auth-server test
pnpm --filter @sassy-auth/admin test
```
Expected: all three PASS. If anything is already red, stop and fix it before touching Prisma — otherwise you can't tell a migration regression from a pre-existing failure.

- [ ] **Step 3: Bump `packages/db/package.json` to Prisma 6**

Edit `packages/db/package.json`:
```json
    "@prisma/client": "^6.0.0"
```
and:
```json
    "prisma": "^6.0.0",
```
(Both lines currently read `^5.14.0` — see `packages/db/package.json:28` and `:35`.)

- [ ] **Step 4: Install**

```bash
pnpm install
```
Expected: lockfile updates for `prisma` and `@prisma/client` to a `6.x` resolved version, no install errors. The `postinstall: prisma generate` script in `packages/db/package.json` runs automatically here — expected to succeed since the generator provider (`prisma-client-js`) is unchanged in v6.

- [ ] **Step 5: Commit**

```bash
git add packages/db/package.json pnpm-lock.yaml
git commit -m "chore(db): bump prisma to v6"
```

### Task 2: Isolate the v6 implicit-relation migration (safety net)

Prisma 6 changes the unique index on implicit many-to-many join tables to a primary key. Our schema (`packages/db/schema.prisma`) has no implicit m:n relations — every join model (`SaRolePermission`, `SaUserRole`, `SaUserPermission`) is explicit with its own `@@id([...])` — so this step is expected to be a no-op. Run it anyway so an empty diff is a verified fact, not an assumption.

**Files:**
- Read only: `packages/db/schema.prisma`
- Generated: a new folder under `packages/db/migrations/` (only if Prisma detects a diff)

- [ ] **Step 1: Run migrate dev against a local Postgres**

Ensure a Postgres instance matching `.env.local`'s `DATABASE_URL` is running (e.g. `postgresql://postgres:postgres@localhost:5432/sassyauth` per `.env.example:2`), then:

```bash
pnpm --filter @sassy-auth/db db:migrate -- --name upgrade-to-v6
```

- [ ] **Step 2: Verify no migration was created**

```bash
git status --porcelain packages/db/migrations/
```
Expected: empty output. If a new migration folder *was* created, read its generated SQL before committing it — it should only touch the three join tables listed above, and only their index/PK definition, nothing else. If it touches anything else, stop and investigate before proceeding (do not blindly accept generated SQL).

- [ ] **Step 3: Commit only if Step 2 produced a migration**

```bash
git add packages/db/migrations/
git commit -m "chore(db): isolate prisma v6 implicit-relation migration"
```
If Step 2's `git status` was empty, skip this commit — there is nothing to add.

### Task 3: Phase A regression pass

**Files:** none (verification only)

- [ ] **Step 1: Re-run the full test suite**

```bash
pnpm --filter @sassy-auth/db test
pnpm --filter @sassy-auth/auth-server test
pnpm --filter @sassy-auth/admin test
```
Expected: all PASS, identical results to Task 1 Step 2's baseline.

- [ ] **Step 2: Typecheck both apps**

```bash
pnpm --filter @sassy-auth/auth-server build
pnpm --filter @sassy-auth/admin build
```
Expected: both build cleanly (this is the project's typecheck gate — see the comment at `apps/auth-server/tsconfig.json` re: bug-0092).

Phase A is done and independently shippable at this point.

---

## Phase B: Prisma 6 → 7

### Task 4: Add the driver-adapter and CLI-config dependencies

**Files:**
- Modify: `packages/db/package.json`

- [ ] **Step 1: Add `@prisma/adapter-pg` and `pg` to `packages/db/package.json`**

Add to `"dependencies"`:
```json
    "@prisma/adapter-pg": "^7.0.0",
    "pg": "^8.13.0"
```
Add to `"devDependencies"`:
```json
    "@types/pg": "^8.11.0"
```

- [ ] **Step 2: Bump the Prisma packages themselves**

In `"dependencies"`, change:
```json
    "@prisma/client": "^7.0.0"
```
In `"devDependencies"`, change:
```json
    "prisma": "^7.0.0",
```

- [ ] **Step 3: Install**

```bash
pnpm install
```
Expected: this install is likely to fail or the subsequent `postinstall: prisma generate` to error, because the schema still says `provider = "prisma-client-js"` with no `output`/`moduleFormat`, and there is no `prisma.config.ts` yet for the v7 CLI to resolve the datasource from. That failure is expected here — Task 5 and Task 6 fix it. Do not troubleshoot yet; just confirm the error is a generator/config resolution error and not a network/registry failure (i.e. the packages themselves installed).

- [ ] **Step 4: Commit the version bump on its own**

```bash
git add packages/db/package.json pnpm-lock.yaml
git commit -m "chore(db): bump prisma to v7 (generator/config migration follows)"
```

### Task 5: Switch the generator and add `prisma.config.ts`

**Files:**
- Modify: `packages/db/schema.prisma:1-3`
- Create: `packages/db/prisma.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Update the generator block**

In `packages/db/schema.prisma`, replace:
```prisma
generator client {
  provider = "prisma-client-js"
}
```
with:
```prisma
generator client {
  provider     = "prisma-client"
  output       = "./generated/prisma"
  moduleFormat = "cjs"
}
```
`moduleFormat = "cjs"` is what keeps the generated client CommonJS-compatible with `apps/auth-server`'s NestJS/`ts-jest` setup (`"module": "commonjs"` in `apps/auth-server/tsconfig.json`) and with `packages/db/tsconfig.json`'s own `"module": "commonjs"` — without it, Prisma 7 defaults to an ESM-only client that a `require()`-based CommonJS project cannot consume synchronously.

- [ ] **Step 2: Create `packages/db/prisma.config.ts`**

```typescript
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'schema.prisma',
  migrations: {
    path: 'migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
```
This replaces the implicit schema/env resolution the v6 CLI did for free. It reads `process.env.DATABASE_URL` directly — the existing `db:generate` / `db:migrate` / `db:migrate:deploy` scripts in `packages/db/package.json` already run through `dotenv-cli -e ../../.env.local --` before invoking `prisma`, so `DATABASE_URL` is already a real environment variable by the time this config file's code runs. No change needed to those scripts.

- [ ] **Step 3: Ignore the new generated-client output directory**

Add to `.gitignore` (create the file if it doesn't already have a Prisma section):
```
packages/db/generated/
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/schema.prisma packages/db/prisma.config.ts .gitignore
git commit -m "chore(db): switch to prisma-client generator with cjs output and add prisma.config.ts"
```

### Task 6: Wire the driver adapter and update import paths

**Files:**
- Modify: `packages/db/index.ts`
- Modify: `packages/db/two-factor-fields.spec.ts:3`

- [ ] **Step 1: Update `packages/db/index.ts`**

Current content:
```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export * from '@prisma/client';
```

Replace with:
```typescript
import { PrismaClient } from './generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export * from './generated/prisma';
```

- [ ] **Step 2: Update `packages/db/two-factor-fields.spec.ts`**

Change line 3 from:
```typescript
import { Prisma } from '@prisma/client';
```
to:
```typescript
import { Prisma } from './generated/prisma';
```

- [ ] **Step 3: Regenerate the client and confirm it builds**

```bash
pnpm --filter @sassy-auth/db exec prisma generate
pnpm --filter @sassy-auth/db build
```
Expected: `prisma generate` writes into `packages/db/generated/prisma`, and `tsc` (via the `build` script) compiles `index.ts` and `two-factor-fields.spec.ts` cleanly against the new import paths.

- [ ] **Step 4: Commit**

```bash
git add packages/db/index.ts packages/db/two-factor-fields.spec.ts
git commit -m "feat(db): construct PrismaClient with @prisma/adapter-pg and update generated-client import paths"
```

### Task 7: Update Docker build and CI workflow

**Files:**
- Modify: `docker/Dockerfile.auth-server:30`
- Modify: `.github/workflows/e2e.yml`

- [ ] **Step 1: Copy `prisma.config.ts` into the Docker `deps` stage**

In `docker/Dockerfile.auth-server`, immediately after line 30 (`COPY packages/db/schema.prisma packages/db/`), add:
```dockerfile
COPY packages/db/prisma.config.ts packages/db/
```
This must land before `RUN pnpm install --frozen-lockfile` (line 38), since that install triggers `postinstall: prisma generate`, which now needs `prisma.config.ts` to resolve the schema path.

No other Dockerfile change is needed: `docker/entrypoint-auth-server-prod.sh` runs `npx prisma migrate deploy` from `/app/packages/db` with `DATABASE_URL` already present as a real container environment variable (not a `.env` file), which the new `prisma.config.ts` reads directly via `process.env.DATABASE_URL` — same as local dev.

- [ ] **Step 2: Drop the removed `--schema` flag in the e2e workflow**

In `.github/workflows/e2e.yml`, the two lines:
```yaml
      - name: Generate Prisma client
        run: pnpm --filter @sassy-auth/db exec prisma generate --schema=schema.prisma

      - name: Apply migrations
        run: pnpm --filter @sassy-auth/db exec prisma migrate deploy --schema=schema.prisma
```
become:
```yaml
      - name: Generate Prisma client
        run: pnpm --filter @sassy-auth/db exec prisma generate

      - name: Apply migrations
        run: pnpm --filter @sassy-auth/db exec prisma migrate deploy
```
Prisma 7 removes the `--schema` CLI flag (schema location is now declared in `prisma.config.ts`, added in Task 5), so passing it would now error the CI job outright.

- [ ] **Step 3: Commit**

```bash
git add docker/Dockerfile.auth-server .github/workflows/e2e.yml
git commit -m "chore(ci,docker): update prisma CLI invocations for v7 (config file, no --schema flag)"
```

### Task 8: Full regression pass (unit + real-Postgres integration)

All existing `packages/db` and `apps/auth-server` Jest specs mock `better-auth`'s Prisma adapter (see `apps/auth-server/src/auth/auth.config.spec.ts:9`) rather than hitting a live database, so they cannot by themselves prove the new `@prisma/adapter-pg`-based client actually talks to Postgres. The Playwright e2e suite (`apps/admin-e2e`) is the only thing in this repo that runs migrations and queries against a real database end-to-end, so it is the real gate for this phase.

**Files:** none (verification only)

- [ ] **Step 1: Unit test regression**

```bash
pnpm --filter @sassy-auth/db test
pnpm --filter @sassy-auth/auth-server test
pnpm --filter @sassy-auth/admin test
```
Expected: all PASS.

- [ ] **Step 2: Typecheck both apps**

```bash
pnpm --filter @sassy-auth/auth-server build
pnpm --filter @sassy-auth/admin build
```
Expected: both build cleanly.

- [ ] **Step 3: Real-Postgres smoke test locally**

With a local Postgres reachable at `.env.local`'s `DATABASE_URL`:
```bash
pnpm --filter @sassy-auth/db db:migrate:deploy
pnpm --filter @sassy-auth/db db:seed
```
Expected: migrations apply cleanly against the adapter-based client, and the seed script (which exercises `create`/`upsert` calls through `prisma`) completes without error.

- [ ] **Step 4: Run the full Playwright e2e suite**

Follow the same sequence as `.github/workflows/e2e.yml` (Task 7 already updated it) against a real Postgres instance — either push the branch and let the `e2e` GitHub Actions workflow run, or reproduce it locally by pointing `DATABASE_URL` at a scratch Postgres and running:
```bash
pnpm --filter @sassy-auth/admin-e2e test:e2e
```
Expected: all ~170 e2e tests PASS, including `apps/admin-e2e/tests/signup.spec.ts`. This is the step that actually validates the driver-adapter migration end-to-end — treat a failure here as a blocking finding, not something to defer.

- [ ] **Step 5: Final commit (if any fixes were needed in Steps 1-4)**

```bash
git add -A
git commit -m "fix(db): address prisma v7 regression findings"
```
Skip this step if Steps 1-4 required no code changes.

---

## Self-Review Notes

- **Spec coverage:** generator switch ✓ (Task 5), mandatory driver adapter ✓ (Task 6), `prisma.config.ts` ✓ (Task 5), CommonJS preservation via `moduleFormat` ✓ (Task 5), Docker build update ✓ (Task 7), CI `--schema` flag removal ✓ (Task 7), import-path updates at both call sites (`index.ts`, `two-factor-fields.spec.ts`) ✓ (Task 6), v6 implicit-relation safety net ✓ (Task 2), real-database verification given the mocked unit-test suite ✓ (Task 8).
- **Not in scope, deliberately:** Prisma 8 (still `-rc`, different config/contract model entirely — see the prior investigation). `better-auth`'s Prisma adapter compatibility with v7 is exercised indirectly by Task 8's e2e run (every BetterAuth-backed auth flow in `apps/admin-e2e` goes through it) rather than a bespoke unit test, since BetterAuth ships no test hooks of its own to unit-test its adapter in isolation here.
