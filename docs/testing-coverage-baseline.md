# Test coverage baseline

Recorded 2026-08-24 on branch `chore/discovery-work-items`, at commit
`3148696` (the tip of the grove discovery work). This is the reference point
for grove W-48, which enforces per-package floors, and the evidence base for
answering grove Q-06 ("what coverage floor is acceptable per package without
stalling delivery?").

## How to reproduce

Per package, from the repository root:

```bash
pnpm --filter admin       test -- --coverage --coverageReporters=text-summary
pnpm --filter auth-server test -- --coverage --coverageReporters=text-summary
pnpm --filter ui          test -- --coverage --coverageReporters=text-summary
pnpm --filter db          test -- --coverage --coverageReporters=text-summary
```

Drop `--coverageReporters=text-summary` for the per-file breakdown, which is
what you want when deciding where the next test should go.

These are unit runs only. The auth-server e2e suite is a separate config
(`pnpm --filter auth-server test:e2e`, `test/jest-e2e.json`) and needs a
database; the admin e2e suite is Playwright under `apps/admin-e2e` and needs
Docker. Neither contributes to the numbers below. The auth-server unit config
sets `rootDir: src` and mocks better-auth, otplib and uuid, so no unit test
touches a database or the network.

## Baseline

| Package | Suites | Tests | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `admin` | 42 | 298 | 74.73% | 68.68% | 62.95% | 78.42% |
| `auth-server` | 70 | 678 | not measured | not measured | not measured | not measured |
| `ui` | 4 | 15 | 97.36% | 57.14% | 90.32% | 97.29% |
| `db` | 1 | 4 | n/a | n/a | n/a | n/a |
| `types` | — | — | — | — | — | — |

All suites pass. `pnpm --filter <pkg> typecheck:ci` is clean for `admin`,
`auth-server` and `ui`.

### Notes per package

**`admin`** — the only package with a measured, meaningful figure. The gap
between lines (78%) and functions (63%) is the shape to expect from a UI
package: whole event handlers and drawer callbacks are never invoked by the
current tests even though the surrounding module is imported and rendered.
Branches at 69% is the number worth moving, since that is where the untested
error paths live.

**`auth-server`** — pass baseline is solid (70 suites, 678 tests, ~55s without
instrumentation) but the coverage run was not completed, so the four
percentages are genuinely unknown rather than estimated. This is the one gap in
this document. It matters most, because it is the largest package and the one
W-28 through W-37 target. Fill it before setting a floor for this package.

**`ui`** — high statement and line coverage but branches at 57% is the outlier
in the table. These are presentational components where the untested branches
are conditional class names and optional props. Cheap to raise, low value in
doing so; do not let this number drive the floor.

**`db`** — reports `0/0`, which is not a failure. The single spec
(`two-factor-fields.spec.ts`) reads `schema.prisma` as text and asserts on its
contents, so no instrumented JavaScript executes. `packages/db/index.ts` (the
Prisma client singleton) has no test at all. A coverage floor is meaningless
here; assert on the schema instead.

**`types`** — has no `test` script and no tests. This is grove W-25, which adds
the jest project, and W-26/W-27, which cover `detectIdentifierType`. There is
nothing to measure until W-25 lands.

## What this implies for Q-06

Do not set one workspace-wide floor. The four packages are not comparable:
`ui` is presentational, `db` has no instrumented code, and `admin` and
`auth-server` carry the logic. A single number would either be too low to
constrain the packages that matter or too high for the ones that do not.

The defensible shape is a per-package floor set at or just below each package's
measured baseline, so it ratchets rather than blocks:

- `admin` — floor at the current numbers, rounded down (statements 74,
  branches 68, functions 62, lines 78).
- `auth-server` — cannot be set responsibly until the run above is completed.
- `ui` — statements/lines only. Excluding branches avoids chasing conditional
  class names for no real assurance.
- `db` — no floor. Coverage is the wrong instrument for a schema assertion.
- `types` — set once W-25 lands; a new, small, pure-logic package should start
  high.

Setting floors at the baseline means the next change cannot silently reduce
coverage, which is the actual goal, without requiring anyone to write tests for
existing untested code before they can ship.
