# TODO — Follow-ups from 2026-05-27 Daily Review

Living list of risky patterns, missing tests, and design-level follow-ups surfaced by the daily code review. Mechanical fixes are tracked in [BUGs.md](./BUGs.md); this file collects everything that needs **judgement, planning, or larger context** before action.

## Ship blockers (must resolve before pushing to `origin/master`)

- [ ] **Resolve `bug-0001`** — RBAC tenant isolation. Picks a design: (a) `orgScope` param on `checkPermission`, or (b) `assertSameOrg` helper layered on every `UsersService` method. Pre-condition for any multi-tenant claim.
- [ ] **Resolve `bug-0002`** — invitation tokens leaked via request URL in `RequestLoggingMiddleware`. Scrubber must apply to Sentry breadcrumbs too.
- [ ] **Resolve `bug-0003`** — admin Next.js middleware must call `auth.api.getSession()` (or equivalent) instead of trusting any non-empty cookie.

## Missing test coverage

- [ ] **Cross-org access tests** for every `UsersService` method (`getUser`, `updateUser`, `deleteUser`, `assignRole`, `removeRole`, `resendInvitation`, `getUserRoles`, `getEffectivePermissions`, `listUsers`). Currently zero tenant-isolation coverage.
- [ ] **`RequestLoggingMiddleware` spec** for token / sensitive-query scrubbing (currently no test file).
- [ ] **`RequestIdMiddleware` spec** for malicious inbound values (only happy-path tested today).
- [ ] **`auth-server` E2E** for full invite → accept → login → JWT flow (`apps/auth-server/test/` has the OAuth flow but not invite acceptance).
- [ ] **Concurrent-accept** test for `acceptInvitation` (bug-0006).
- [ ] **`SentryExceptionFilter` integration** test: assert that 4xx are NOT forwarded, 5xx ARE forwarded, both with redacted PII.
- [ ] **Admin Playwright/E2E suite** — none exists. At minimum: login → users list → open drawer → create user → copy invite URL.
- [ ] **`packages/ui` primitives** have no test files. Add visual / unit coverage at least for `DataTable`, `Select`, `Sheet`.
- [ ] **`acceptInvitation` server-side password validation** is `@MinLength(8)`; the client form checks `password.length < 8` again. Document policy alignment when bug-0007 lands.

## Risky patterns (architectural)

- [ ] **`UsersService.createUser` writes BetterAuth `user` row directly via `tx.user.create({ id: baUserId, ... })`**.
  Bypassing BetterAuth's signup hook means any future BetterAuth-managed side effects (sending welcome email, populating `verification`, custom rate limits) won't fire. Consider invoking BetterAuth's signup API server-side instead, or document this as intentional and add a comment pointing to the bypass.
- [ ] **In-memory authorization code store** (already noted in README "Known Limitations") needs Redis / DB-backed implementation before any production deploy.
- [ ] **`redirect_uri` allowlist** — `POST /api/token/oauth/token` accepts arbitrary `redirect_uri`. Open-redirect surface.
- [ ] **`client_secret` not validated** — currently accepted but not checked.
- [ ] **`SqidService` not injected into `UsersService` / `InvitationsService`**. The temporary UUID-slice scheme (bug-0005) was introduced because the service didn't have access. Wire the dependency.
- [ ] **Static `ADMIN_URL` env-var usage** in `UsersService.createUser` and `resendInvitation` — multi-tenant per-org admin URLs not modeled. Acceptable for v1 but flag for design.
- [ ] **`Sentry.setUser({ email })`** propagates PII to a third-party service. Centralize identification (helper that always emits `id` only) — see bug-0004.

## Configuration / ops follow-ups

- [ ] **Sentry dashboard config audit** (bug-0010) — allowed domains for the admin DSN; verify `hideSourceMaps` for the public build.
- [ ] **Sentry release tagging** — set `release` to the git SHA in both `instrument.ts` and `sentry.client.config.ts` so error tracking aligns with deploys.
- [ ] **Sentry `tracesSampleRate`** — currently 1.0 by default. Drop to 0.1–0.2 before any meaningful traffic.
- [ ] **Log file rotation** in dev mode — Winston file transport is set up; confirm `daily-rotate-file` or size-based rotation is configured to avoid filling local disks.
- [ ] **`.env.example` is missing `AUTH_SERVER_URL`** that the admin's Server Actions read. Add it (defaults to `http://localhost:3000`).
- [ ] **`pnpm-workspace.yaml` and `turbo.json`** — review whether `admin` and `ui` are properly wired into the `dev`/`build` pipelines after the new packages landed.

## Sub-project debt

- [ ] **In-memory OAuth code store** (existing README "Known Limitations").
- [ ] **`redirect_uri` allowlist not enforced** (existing).
- [ ] **`client_secret` not validated** (existing).
- [ ] **Management UI** — partially started this commit cycle; users management drawer is live, but orgs / apps / roles / permissions CRUD is not yet covered.
- [ ] **`bug-0015`** — `acceptInvitation` doesn't revoke sibling sessions. Track for a session-mgmt sub-project.
- [ ] **`bug-0008`** — confirm auth-server never returns 403 on invalid email (residual enumeration risk).

## Documentation

- [ ] **Update README.md** to reflect the monorepo layout — admin app, `packages/ui`, observability env vars, `ADMIN_URL`, `AUTH_SERVER_URL`. *(done in this review pass)*
- [ ] **`packages/ui` README** — empty. Document tokens, components, the `transpilePackages` requirement for consumers.
- [ ] **Admin app README** — none. Cover `pnpm --filter @sassy-auth/admin dev`, the env vars it consumes, and the i18n setup.
- [ ] **Architecture diagram** of `admin → auth-server → DB` request flow with cookie / session propagation drawn explicitly. Helpful for onboarding and for proving the bug-0003 fix.

## Dev experience

- [ ] **`pnpm test` from repo root** runs Jest in both apps, but no aggregated coverage report.
- [ ] **No `pnpm lint`** wired into CI — `turbo lint` exists but per-package configs may diverge.
- [ ] **No CI workflow at all** — `.github/workflows/` is empty (no GH Actions). At minimum: typecheck + test + lint on PR.

---

*Generated as part of the 2026-05-27 daily code review. See [CHANGELOG.md](./CHANGELOG.md), [BUGs.md](./BUGs.md), and `CR-05-27-2026.md` for the long-form review.*
