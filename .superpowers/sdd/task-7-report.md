# Task 7 Report — Login-time optional 2FA interstitial

## Status: DONE

## What was implemented

### 7a/7b — `shouldPromptTwoFactor` pure function (TDD)
- Spec written first at `apps/auth-server/src/auth/should-prompt-two-factor.spec.ts`
- Implementation at `apps/auth-server/src/auth/should-prompt-two-factor.ts`
- 6/6 tests pass (null promptedAt, enrolled, within-interval, boundary, past-interval, zero-interval)

### 7c — `GET /api/me/two-factor-status` + `POST /api/me/two-factor-prompted`
Added to `apps/auth-server/src/me/me.controller.ts` and `apps/auth-server/src/me/me.service.ts`.
Both endpoints are behind `@UseGuards(BetterAuthGuard)` (class-level guard), reading/writing only the caller's own `twoFactorPromptedAt`. `updateMany` keyed on `betterAuthUserId` (unique but not PK) makes the write idempotent.

### 7d — `GET /api/token/app-trust-days?client_id=`
Added to `apps/auth-server/src/token/token.controller.ts` as a no-guard endpoint. Returns `{ twoFactorTrustDays: number | null }`. Disclosure is safe: `twoFactorTrustDays` is a non-sensitive config value and `client_id` (sqid) is already public.

### 7e — `signIn` server action patch
`apps/admin/app/login/actions.ts` now, after successful session cookie forwarding:
1. Fetches `/api/auth/get-session` + `/api/me/two-factor-status` in parallel to read `twoFactorEnabled` and `twoFactorPromptedAt`.
2. Resolves interval: if `nextSafe` URL contains `client_id`, fetches `/api/token/app-trust-days?client_id=…`; falls back to `getSystemTrustDaysClient()` (env var `TWO_FACTOR_TRUST_DAYS`, default 14).
3. If `shouldPromptTwoFactor` returns true, redirects to `/login/two-factor-prompt?next=…`.
4. All fetch errors fail-open (no prompt shown, user proceeds normally).

### 7f — `apps/admin/lib/two-factor-prompt.ts`
Client-side copy of `shouldPromptTwoFactor` + `getSystemTrustDaysClient()`. Used in the server action. The canonical unit-tested version remains in auth-server.

### 7g — `/login/two-factor-prompt` interstitial page
- `apps/admin/app/login/two-factor-prompt/page.tsx` — server page, validates `next` param
- `apps/admin/app/login/two-factor-prompt/TwoFactorPromptClient.tsx` — client component
- `apps/admin/app/api/proxy/me/two-factor-prompted/route.ts` — Next.js API route that proxies `POST /api/me/two-factor-prompted` to auth-server with session cookie forwarding

"Set up 2FA" → `/account/security?next=…`; "Skip" → `next || '/users'`. Both paths call `recordPrompt()` best-effort.

### 7h — i18n
`twoFactorPrompt.*` keys added to both `apps/admin/messages/en.json` and `apps/admin/messages/fr.json`.

## Endpoints added and why

| Endpoint | Auth | Why |
|---|---|---|
| `GET /api/me/two-factor-status` | BetterAuthGuard | Reads caller's own `twoFactorPromptedAt` for the interval check |
| `POST /api/me/two-factor-prompted` | BetterAuthGuard | Records prompt timestamp when shown/skipped |
| `GET /api/token/app-trust-days?client_id=` | None (public sqid) | Returns per-app `twoFactorTrustDays` to the server action without duplicating `resolveTrustDays` client-side |

## Simplifications vs the brief

The brief suggested a client-side copy (`apps/admin/lib/two-factor-prompt.ts`) alongside the canonical server function. Since the `signIn` action is a Server Action (runs server-side), the copy is used there — but it avoids the brief's more complex proposal of fetching `app-trust-days` via a separate client-side path. The prompt decision is made entirely server-side in `signIn`. The client component (`TwoFactorPromptClient`) only records the prompt and navigates — it never re-evaluates whether to prompt.

The `app-trust-days` endpoint was retained (rather than inlining the DB query in `signIn`) because it keeps the interval resolution logic in one place (auth-server) and avoids importing Prisma directly into the Next.js server action layer.

## Build gates
- `shouldPromptTwoFactor` jest spec: 6 passed, 6 total
- `@sassy-auth/auth-server build`: clean (nest build, no TS errors)
- `@sassy-auth/admin build`: clean, `/login/two-factor-prompt` appears in route list

---

## Review Fix Report (post-review changes)

### Finding 1 (Important) — reuse `resolveTrustDays` in app-trust-days endpoint

**File:** `apps/auth-server/src/token/token.controller.ts`

- Added import: `import { resolveTrustDays, getSystemTrustDays } from '../auth/resolve-trust-days';`
- `appTrustDays` handler now calls `resolveTrustDays(app, getSystemTrustDays())` and returns `{ effectiveTrustDays: number }` (always a resolved positive integer).
- Missing `client_id` and app-not-found paths both return `{ effectiveTrustDays: getSystemTrustDays() }` as fallback, preserving equivalent semantics to the previous `null` return.

### Finding 3 (Minor) — simplify consumer in `signIn` server action

**File:** `apps/admin/app/login/actions.ts`

- Changed response type annotation from `{ twoFactorTrustDays: number | null }` to `{ effectiveTrustDays: number }`.
- Updated read from `data.twoFactorTrustDays` to `data.effectiveTrustDays`.
- Removed now-redundant `typeof === 'number' && > 0` guard — the value is always a resolved positive integer.

### Finding 2 (Minor) — align client fallback guard

**File:** `apps/admin/lib/two-factor-prompt.ts`

- Changed `Number.isFinite(n) && n > 0` to `Number.isInteger(n) && n > 0` in `getSystemTrustDaysClient()`, matching the canonical `getSystemTrustDays()` in auth-server (rejects non-integer floats like 1.5).

### Verification output

```
# jest (resolve-trust-days.spec.ts + should-prompt-two-factor.spec.ts)
PASS src/auth/resolve-trust-days.spec.ts
PASS src/auth/should-prompt-two-factor.spec.ts
Test Suites: 2 passed, 2 total
Tests:       18 passed, 18 total

# @sassy-auth/auth-server build
> nest build
(clean, no errors)

# @sassy-auth/admin build
> next build
✓ Compiled successfully in 17.1s
✓ Generating static pages (12/12)
(clean, no errors)
```
