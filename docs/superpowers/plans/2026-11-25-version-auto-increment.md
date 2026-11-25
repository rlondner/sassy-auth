# Version Auto-Increment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto patch-bump `apps/admin`, `apps/admin-e2e`, `apps/auth-server` on every push to `dev`, deploy staging from the bumped commit, and show the admin version in the sidebar.

**Architecture:** A new `version-bump.yml` workflow computes affected workspace packages with Turborepo, bumps them via a small tested Node script, pushes the bump commit with `GITHUB_TOKEN`, then explicitly dispatches `deploy-render-staging.yml` (pushes made with `GITHUB_TOKEN` do not trigger workflows, so the deploy cannot rely on its own `push` trigger). The admin sidebar reads `apps/admin/package.json` in the server component and passes the version to the client sidebar.

**Tech Stack:** GitHub Actions, pnpm 9, Turborepo 2, Node 24, Next.js (admin), Jest + Testing Library, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-24-version-auto-increment-design.md`

## Global Constraints

- Bump kind is always **patch**; minor/major stay manual edits.
- Only `apps/admin`, `apps/admin-e2e`, `apps/auth-server` are bumped; never `packages/*`; never on `master`.
- Commit message format: `chore: bump admin to 0.6.2, auth-server to 0.5.9 [version-bump]` (only apps that bumped; marker `[version-bump]` exactly).
- Concurrency group `version-bump-dev`, `cancel-in-progress: false`.
- `deploy-render-staging.yml`: remove `push: branches: [dev]`, keep `workflow_dispatch`. `deploy-render.yml` (master) and `deploy-gcp.yml` are untouched.
- Sidebar text renders exactly `Admin Console (v{appVersion})`, e.g. "Admin Console (v0.5.1)".
- Swagger needs no code change (`apps/auth-server/src/main.ts:247` already uses `pkg.version`).
- Commits land directly on the current branch (`dev`) and are pushed; do not branch first.

## Review Focus

- Push touches only files outside any app (docs, `.github`): no app affected → no bump commit, but staging deploy is still dispatched.
- Only `packages/db` changed: `auth-server` bumps, `admin` and `admin-e2e` do not (and vice versa for `packages/ui`).
- `admin-e2e` has no `build` script, so `turbo run build --dry-run` would never list it: affected detection must use `turbo ls`.
- Head commit message contains `[version-bump]` (even in a multi-line message): workflow exits without bumping or dispatching.
- Push rejected because another merge landed during the job: rebase and retry once rather than fail with a stale base.
- Shallow checkout: `before` SHA must be reachable (`fetch-depth: 0`); `before` of all zeros (new branch) must not crash.

---

### Task 1: Show version in admin sidebar

**Files:**
- Modify: `apps/admin/components/admin-shell.tsx` (import + `appVersion` prop pass-through, around line 45)
- Modify: `apps/admin/components/sidebar-shell.tsx:29-38` (props), `:53` (subtitle)
- Test: `apps/admin/components/__tests__/admin-shell.test.tsx`

**Interfaces:**
- Produces: `SidebarShellProps.appVersion: string` (required).

- [ ] **Step 1: Write the failing test.** In `admin-shell.test.tsx`, extend the `SidebarShell` mock to also accept `appVersion` and render `<span data-testid="app-version">{appVersion}</span>`. Add test `passes the admin package.json version to SidebarShell` that calls `renderShell([])` and asserts `screen.getByTestId('app-version')` has text equal to `require('../../package.json').version`.
- [ ] **Step 2: Run** `pnpm --filter @sassy-auth/admin test -- admin-shell` — expect the new test FAIL (empty/undefined version).
- [ ] **Step 3: Implement.** In `admin-shell.tsx` add `import pkg from '../package.json'` (admin tsconfig already has `resolveJsonModule`) and pass `appVersion={pkg.version}` to `SidebarShell`. In `sidebar-shell.tsx` add `appVersion: string` to `SidebarShellProps`, destructure it, and change the line-53 span content to `Admin Console (v{appVersion})`.
- [ ] **Step 4: Run** the same command plus `pnpm --filter @sassy-auth/admin typecheck` (or `tsc --noEmit` in `apps/admin` if no such script) — expect PASS. Also run the full admin jest suite to catch other `SidebarShell` consumers (`apps/admin/app/login/__tests__/login-forms.test.tsx` references it).
- [ ] **Step 5: Commit** `feat(admin): show app version next to Admin Console in sidebar`.

### Task 2: Bump script

**Files:**
- Create: `scripts/bump-versions.mjs`
- Test: `scripts/bump-versions.test.mjs` (run with `node --test scripts/bump-versions.test.mjs`)

**Interfaces:**
- Produces: `export const BUMPABLE: Record<string, string>` mapping package names to dirs: `{'@sassy-auth/admin':'apps/admin','@sassy-auth/admin-e2e':'apps/admin-e2e','@sassy-auth/auth-server':'apps/auth-server'}`.
- Produces: `export function bumpPatch(version: string): string` (`'0.5.9'` → `'0.5.10'`; throws on non-`x.y.z`).
- Produces: `export function bumpPackages(affected: string[], root: string): {name: string; short: string; from: string; to: string}[]` — for each affected name present in `BUMPABLE`, rewrites that dir's `package.json` `version` (preserving formatting: 2-space JSON + trailing newline) and returns what changed; ignores names not in `BUMPABLE`. `short` is the name without the `@sassy-auth/` scope.
- Produces: `export function commitMessage(bumps): string` — `chore: bump admin to 0.6.2, auth-server to 0.5.9 [version-bump]`.
- CLI: `node scripts/bump-versions.mjs <name> [<name>...]` calls `bumpPackages(argv, repoRoot)` and prints the commit message to stdout (nothing, exit 0, when no bumps).

- [ ] **Step 1: Write failing tests** using a temp dir fixture with three fake app `package.json` files: `bumpPatch('0.5.9') === '0.5.10'`; `bumpPatch('1.2')` throws; `bumpPackages(['@sassy-auth/db'], root)` returns `[]` and leaves files untouched; `bumpPackages(['@sassy-auth/admin','@sassy-auth/db'], root)` bumps only admin, file ends with newline; `commitMessage` for admin+auth-server equals the Global Constraints format with `[version-bump]` last, and for a single app lists only that app.
- [ ] **Step 2: Run** `node --test scripts/bump-versions.test.mjs` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the four exports above in `scripts/bump-versions.mjs` (ESM, no dependencies; guard the CLI with an `import.meta.url` main check so tests can import it).
- [ ] **Step 4: Run** the test file — expect PASS.
- [ ] **Step 5: Commit** `feat(ci): add version bump script`.

### Task 3: Workflows

**Files:**
- Create: `.github/workflows/version-bump.yml`
- Modify: `.github/workflows/deploy-render-staging.yml:3-6` (trigger block)

**Interfaces:**
- Consumes: `scripts/bump-versions.mjs` CLI (Task 2).

- [ ] **Step 1: Edit `deploy-render-staging.yml`:** replace the `on:` block so only `workflow_dispatch: {}` remains, and add a comment that `version-bump.yml` dispatches it after bumping (and why: `GITHUB_TOKEN` pushes don't trigger workflows).
- [ ] **Step 2: Create `version-bump.yml`** with: `on: push: branches: [dev]`; `permissions: contents: write, actions: write`; the `version-bump-dev` concurrency group; one job on `ubuntu-latest` that (a) `if: !contains(github.event.head_commit.message, '[version-bump]')`; (b) checks out with `fetch-depth: 0` and `pnpm/action-setup@v6` + `actions/setup-node@v5` (node 24, `cache: pnpm`) + `pnpm install --frozen-lockfile`, matching the setup in `deploy-render-staging.yml`; (c) computes affected package names with `pnpm exec turbo ls --filter="...[$BEFORE...$AFTER]" --output=json` (`BEFORE`/`AFTER` from `github.event.before`/`after`; if `BEFORE` is all zeros, fall back to `HEAD~1`; verify the exact `turbo ls` JSON shape locally with a throwaway run and parse names with `jq`); (d) runs `node scripts/bump-versions.mjs <names>` capturing the message; (e) if the message is non-empty: configure git user as `github-actions[bot]`, `git add apps/*/package.json`, commit with the message, `git push origin HEAD:dev`, and on rejection run `git pull --rebase origin dev` then push once more; (f) always as the last step, `gh workflow run deploy-render-staging.yml --ref dev` with `GH_TOKEN: ${{ github.token }}`.
- [ ] **Step 3: Validate locally:** `pnpm dlx actionlint` (or `actionlint` if installed) on both files — expect no errors. Locally run the affected command against `HEAD~5...HEAD` and confirm the output lists workspace package names including one of the three apps; run `node scripts/bump-versions.mjs @sassy-auth/admin` in a scratch copy (`git stash`-safe: use `git checkout -- apps/admin/package.json` afterwards) and confirm exactly one line of `package.json` changes.
- [ ] **Step 4: Lockfile check (spec risk):** with that local bump applied, run `pnpm install --frozen-lockfile`; expect success (no lockfile step needed). If it fails, add `pnpm install --lockfile-only` and `git add pnpm-lock.yaml` to the workflow and note it in the commit. Revert the local bump.
- [ ] **Step 5: Commit** `feat(ci): auto-bump app versions on dev and chain staging deploy`, push.
- [ ] **Step 6: Post-merge verification (manual, after the next real merge to `dev`):** a `chore: bump … [version-bump]` commit appears; `version-bump` does not re-run on it; the `Deploy to Render (staging)` run was started by `workflow_dispatch` on the bump commit's SHA; staging sidebar shows the new version; `/api/docs` title shows the new auth-server version.

---

## Self-Review

- Spec coverage: bump workflow, chained deploy, loop guard, concurrency, affected detection (adjusted to `turbo ls`, since `admin-e2e` has no `build` script), commit format, failure behaviour (job failure stops before dispatch because dispatch is the last step and steps are sequential), sidebar, Swagger (no change), lockfile check, manual verification — all mapped.
- Deviation from spec to confirm: the spec names `turbo run build --dry-run=json`; this plan uses `turbo ls` for the reason above.
