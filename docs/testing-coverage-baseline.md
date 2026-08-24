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

| Package | Suites | Tests | Statements | Branches | Functions | Lines | Floor |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `admin` | 42 | 298 | 55.82% | 49.27% | 50.81% | 57.48% | 55 / 49 / 50 / 57 |
| `auth-server` | 70 | 678 | not measured | not measured | not measured | not measured | none |
| `ui` | 4 | 15 | 22.73% | 17.39% | 22.22% | 22.74% | 22 / 17 / 22 / 22 |
| `db` | 1 | 4 | n/a | n/a | n/a | n/a | none |
| `types` | — | — | — | — | — | — | deferred (W-25) |

Floors are listed statements / branches / functions / lines and live in each
package's `jest.coverageThreshold`. They are the measured baseline rounded
down, so they ratchet: no change may reduce coverage, but nobody has to
backfill existing untested code before shipping.

### Measure the whole tree, not the tested subset

These figures depend on `collectCoverageFrom`, which both packages now set.
Without it jest instruments only the files a test actually imports, which
measures the tested subset rather than the codebase — a source file with no
test is simply absent from the denominator, and deleting a test barely moves
the percentage because it removes numerator and denominator together.

The difference is not marginal. Measured without `collectCoverageFrom`, admin
reads 74.73/68.68/62.95/78.42 and ui reads 97.36/57.14/90.32/97.29. Those were
the numbers first recorded here, and they are wrong for this purpose: ui's
"97%" was four tested components out of roughly thirty-five, with the
`src/components/ui/` primitives entirely invisible.

All suites pass. `pnpm --filter <pkg> typecheck:ci` is clean for `admin`,
`auth-server` and `ui`.

### Notes per package

**`admin`** — a little over half the tree is exercised. The server actions and
`lib/` helpers are now well covered; the untested bulk is page components and
the resource drawers under `components/`, which grove W-38 through W-44
target.

**`auth-server`** — pass baseline is solid (70 suites, 678 tests, ~55s without
instrumentation) but the coverage run was not completed, so the four
percentages are genuinely unknown rather than estimated. This is the one gap in
this document. It matters most, because it is the largest package and the one
W-28 through W-37 target. Fill it before setting a floor for this package.

**`ui`** — 22% across the board. Four components have specs (`confirm-dialog`,
`data-table`, `status-chip`, `user-avatar`); the roughly thirty shadcn-derived
primitives under `src/components/ui/` have none. Worth deciding separately
whether vendored primitives should count at all — excluding them would raise
the figure without adding a single test, so it is a reporting choice, not a
quality one, and it is deliberately not made here.

**`db`** — reports `0/0`, which is not a failure. The single spec
(`two-factor-fields.spec.ts`) reads `schema.prisma` as text and asserts on its
contents, so no instrumented JavaScript executes. `packages/db/index.ts` (the
Prisma client singleton) has no test at all. A coverage floor is meaningless
here; assert on the schema instead.

**`types`** — has no `test` script and no tests. This is grove W-25, which adds
the jest project, and W-26/W-27, which cover `detectIdentifierType`. There is
nothing to measure until W-25 lands.

## What this implies for Q-06

Do not set one workspace-wide floor. The packages are not comparable: `db` has
no instrumented code at all, `ui` is a component library whose untested bulk is
vendored primitives, and `admin` and `auth-server` carry the logic. A single
number would either be too low to constrain the packages that matter or too
high for the ones that do not.

The floors in the table above are each package's measured baseline rounded
down. Setting them AT the baseline is what keeps them non-blocking: nobody has
to backfill existing untested code before shipping, but no change can silently
reduce coverage — which is the actual goal.

- `admin` — 55 / 49 / 50 / 57.
- `ui` — 22 / 17 / 22 / 22.
- `auth-server` — none. Its coverage run was never completed, and a guessed
  number would be worse than no constraint. Its 678 unit tests still gate
  merges via the workflow below; the floor can be added later from a real
  measurement without revisiting anything else here.
- `db` — none. Coverage is the wrong instrument for a schema assertion.
- `types` — deferred until W-25 adds its jest project.

## Enforcement

Floors only bite if something runs them. Before this document, no CI workflow
invoked jest at all — `typecheck.yml` ran `tsc`, `e2e.yml` ran Playwright, and
the 995 unit tests ran nowhere. A `coverageThreshold` would have been
decorative.

`.github/workflows/unit-tests.yml` now runs each package's unit suite on pull
requests and pushes to `master`. `admin`, `ui` and `auth-server` run with
`--coverage`; `db` does not, having nothing to measure. Only `admin` and `ui`
declare thresholds today, so `auth-server`'s coverage run currently just
reports — but the flag is already in place for when its floor is set.

That flag is load-bearing rather than cosmetic: jest evaluates
`coverageThreshold` only when coverage is collected, so dropping it would
silently disable every floor while leaving the workflow green.

Verified rather than assumed: removing
`apps/admin/app/login/__tests__/actions.signin.test.ts` drops admin to 53.96%
statements and exits **1** with `"global" coverage threshold for statements
(55%) not met`; restoring it exits **0**.
