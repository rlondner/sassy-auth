# Contributing to SassyAuth

Thanks for taking an interest. SassyAuth is experimental software maintained in
spare time, so please read [Scope and expectations](#scope-and-expectations)
before investing effort in a large change.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting security issues

**Do not open a public issue for a security vulnerability.** See
[SECURITY.md](SECURITY.md) for private disclosure channels.

## Getting set up

Full instructions are in the [README](README.md#getting-started). The short
version:

**With [Flox](https://flox.dev) (least setup).** `flox activate` in the project
root provisions Node, pnpm and PostgreSQL, generates `.env.local` with an RSA
key pair already filled in, then migrates and seeds:

```bash
flox activate
pnpm dev                                     # auth-server :3000, admin :3001
```

Note that Flox puts its Postgres cluster in `~/.local/share/sassy-auth/postgres`,
which is per-user rather than per-checkout — two clones share one database.

**Without Flox**, bring your own PostgreSQL 14+ and run:

```bash
pnpm install
cp .env.example .env.local                   # config lives in .env.local, not .env
# set DATABASE_URL, BETTER_AUTH_SECRET, and the RSA key pair in .env.local
pnpm --filter @sassy-auth/db db:migrate
pnpm --filter @sassy-auth/db db:generate
pnpm --filter @sassy-auth/db db:seed
pnpm dev
```

`RSA_PRIVATE_KEY` and `RSA_PUBLIC_KEY` are required — see
[RSA Key Pair Generation](README.md#rsa-key-pair-generation) for the two
`openssl` commands that produce them.

`docker-compose.dev.yml` is **not** a database. It starts [Mailpit](README.md#local-email-testing-mailpit)
for local email testing only; you still need Postgres from Flox or your own
installation.

The seed creates platform admins with a well-known development password; sign in
as `s@sa.io`. That default only works when `NODE_ENV` is `development` or
`test`.

## Before you open a pull request

Run what CI runs:

```bash
pnpm test                                           # unit tests
pnpm --filter @sassy-auth/auth-server build         # typecheck gate
pnpm --filter @sassy-auth/admin-e2e test:e2e        # e2e (both servers must be running)
```

The e2e suite is the slow one (~170 tests, serial in CI). If your change does
not touch the admin console or the auth flows, running the unit tests and the
build is usually enough — CI will catch the rest.

### Tests

New behaviour needs a test, and bug fixes need a test that fails before the fix.
This is the one process point we are strict about: a regression test is what
stops a bug in an auth server from coming back.

- Unit tests live next to the code as `*.spec.ts` / `*.test.tsx`
- API-level tests are in `apps/auth-server/test/`
- Browser tests are in `apps/admin-e2e/tests/`

### Commits

Conventional-commit style, with the bug number when there is one:

```
fix(bug-0234): stop leaking raw server errors from user actions
feat: add email OTP sign-in
docs: note the Express-level BetterAuth rate limiter
```

Keep a pull request to one logical change. If you find an unrelated problem
along the way, open a separate issue rather than widening the diff.

## Scope and expectations

**Good contributions**, roughly in order of how likely they are to be merged:

- Fixes for anything in [Known Limitations](README.md#known-limitations) — these
  are known gaps with the reasoning already written down
- Bug fixes with a failing test
- Documentation corrections, especially anywhere the README drifted from the code
- Test coverage for existing behaviour

**Please open an issue first** for new features, dependency swaps, renames or
broad refactors, and anything that changes the data model, a token's shape, or
an existing HTTP contract. Those touch the security surface or the upgrade path,
and a rejected pull request is a worse outcome for you than a five-minute
conversation.

**Realistically out of scope:** large architectural rewrites, alternative
database backends, and new authentication protocols. Not because they are bad
ideas — the project is just too small to maintain them.

## Project layout

```
apps/
  auth-server/              NestJS. Auth flows, tokens, management API. :3000
  admin/                    Next.js admin console. :3001
  admin-e2e/                Playwright suite
  resource-server-fastapi/  Sample resource server — example code, not a component
packages/
  db/                       Prisma schema, client, migrations
  types/                    Shared TypeScript types
  ui/                       Tailwind + Radix design system
docs/
  api/                      OpenAPI spec
  history/                  Archived development record — not maintained
```

## A note on how this codebase was built

SassyAuth was written largely by AI coding agents against human-reviewed plans.
The record is archived in [`docs/history/`](docs/history/). Two practical
consequences for contributors:

- **Comments explaining *why* are load-bearing.** Several non-obvious decisions
  are documented only in a comment at the call site, often citing a bug number.
  Please preserve them, and add your own for anything surprising.
- **Consistency may be imperfect.** If you find two parts of the codebase
  disagreeing about how to do the same thing, that is a real finding — open an
  issue.

## Questions

Open a [discussion or issue](https://github.com/rlondner/sassy-auth/issues).
Response times are best-effort.
