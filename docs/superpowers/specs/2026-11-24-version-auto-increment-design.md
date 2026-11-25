# Version auto-increment policy — design

Date: 2026-11-24

## Problem

Today, `apps/admin`, `apps/admin-e2e`, and `apps/auth-server` carry a
`version` field in `package.json` that is bumped by hand, rarely, and
with no policy (one commit — `eb1f6a0` — bumped all three from `0.0.1`
to `0.5.0` and nothing has moved since). There is no way to tell, from
the running admin UI or the API's Swagger docs, which build is
deployed. `packages/*` (db, deploy-render, telemetry, types, ui) are
still at their scaffolded `0.0.1` and are out of scope here — they are
private workspace-internal packages, not independently published, so a
version number on them has no consumer.

This design adds an automatic patch bump on every merge to `dev` for
the two deployed apps (and their shared dependents), and surfaces the
resulting version in two places: the admin sidebar, and the
auth-server's Swagger UI.

## Scope

**In scope:**
- Auto-bump `apps/admin`, `apps/admin-e2e`, `apps/auth-server` versions
  on merge to `dev`.
- Display the admin app's version in the sidebar, next to "Admin
  Console".
- Confirm the API version is visible in Swagger UI (it already is,
  dynamically — no code change needed there).

**Out of scope (explicit non-goals):**
- No static `openapi.yaml` file is generated or committed. The live
  Swagger UI / `/api/docs-json` endpoint remains the sole source of
  truth for the OpenAPI spec.
- No conventional-commit / semantic-release style parsing of commit
  messages to decide patch vs. minor vs. major. Every auto-bump is a
  patch bump. Minor/major bumps remain manual edits to `package.json`.
- `packages/*` versions are not touched by this policy.
- No bump on merges to `master` — `master` only receives promotions
  from `dev` and never bumps on its own.

## CI workflow: `.github/workflows/version-bump.yml`

**Trigger:** `push` to `dev` (this is how a PR merge lands on `dev` in
this repo's workflow).

**Loop prevention:** The bump itself produces a commit that is pushed
to `dev`, which would re-trigger this same workflow. Guard against
that by checking `github.event.head_commit.message` for a fixed
marker (`[version-bump]`) at the top of the job and exiting early if
present. Also set a `concurrency` group keyed on the branch
(`group: version-bump-dev`, `cancel-in-progress: false`) so that rapid
successive merges queue sequentially instead of two runs racing to
push based on a stale `before` SHA.

**Affected-package detection:** Using the push event's `before` and
`after` SHAs, compute which workspace packages are affected —
including transitively, through Turborepo's dependency graph — via
`turbo run build --filter="...[<before>...<after>]" --dry-run=json`.
This is what makes a change to a shared package like `packages/db`
correctly flag `auth-server` (and `admin`, if it depends on that
package too) as needing a bump, without hand-maintained path lists.

**Bump mechanics:** For each of `apps/admin`, `apps/admin-e2e`,
`apps/auth-server` that appears in the affected set, run
`npm version patch --no-git-tag-version` in that app's directory.
Each app bumps independently — `admin` and `auth-server` are expected
to drift apart over time (e.g. `admin` at `0.6.2` while `auth-server`
is at `0.5.9`), reflecting that they deploy independently.

**Commit & push:** Stage the changed `package.json` files (and
`pnpm-lock.yaml`, which records workspace versions) and commit as:

```
chore: bump admin to 0.6.2, auth-server to 0.5.9 [version-bump]
```

(include only the apps that actually bumped), then push directly to
`dev` using the default `GITHUB_TOKEN`. `dev` has no branch protection
blocking this today. This push naturally re-triggers
`deploy-render-staging.yml` (already configured to deploy on push to
`dev`), so staging picks up the bumped version — and the
`[version-bump]` marker makes this workflow correctly no-op on that
resulting push.

## Admin UI: version next to "Admin Console"

`apps/admin/components/admin-shell.tsx` is an `async` **server
component** (it already does `await getTranslations()`). It can
import `apps/admin/package.json` directly — this import is evaluated
server-side only and is never bundled to the client — and pass the
version down as a new `appVersion: string` prop to `SidebarShell`.

`apps/admin/components/sidebar-shell.tsx` (`'use client'`) accepts
`appVersion` as a new prop and changes the subtitle at line 53 from:

```tsx
<span className="text-[10px] font-normal text-sidebar-foreground">Admin Console</span>
```

to:

```tsx
<span className="text-[10px] font-normal text-sidebar-foreground">Admin Console (v{appVersion})</span>
```

rendering as **"Admin Console (v0.5.1)"** underneath the "SassyAuth"
brand text (`sidebar-shell.tsx:50-53`).

## API: Swagger UI version

No code change. `apps/auth-server/src/main.ts:247` already does:

```ts
.setVersion(pkg.version)
```

on the `DocumentBuilder` used to build the Swagger doc. Once the
auto-bump workflow is in place, every non-production deploy's Swagger
UI title bar reflects the current `apps/auth-server/package.json`
version with no further work.

## Testing / verification plan

- Unit/integration: none needed for the CI workflow itself (it's a
  shell/YAML job, not application code) — verify by observation after
  the first few real merges to `dev` (check the bump commit appears,
  check it doesn't loop, check staging deploy picks up the new
  version).
- `admin-shell.tsx` → `SidebarShell` prop threading: extend existing
  `apps/admin/components/__tests__/admin-shell.test.tsx` to assert the
  version string renders in the sidebar subtitle.
- Manual check: after the workflow first runs, confirm
  `/api/docs` (Swagger UI, non-production) shows the bumped
  `auth-server` version in its title bar.

## Risks / edge cases

- **Turbo affected-detection false negatives/positives:** if the
  `--filter="...[<before>...<after>]"` computation misses a dependency
  edge, an app could ship without a version bump. This is a
  correctness nuisance, not a breakage — worst case, two deploys in a
  row share a version number.
- **Lockfile churn:** `npm version` only touches the target app's
  `package.json`; `pnpm-lock.yaml` is regenerated/updated by a
  `pnpm install --lockfile-only` step before committing, to keep it
  in sync with the bumped versions.
- **First run:** the very first time this workflow runs, every
  affected-app detection will compare against whatever `before` SHA
  GitHub provides for that push — for a normal PR-merge push this is
  the pre-merge `dev` HEAD, which is the expected comparison base.
