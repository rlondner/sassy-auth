# Final Review Fixes Report

Date: 2026-07-12
Branch: feat/2fa-core

## Fix 1 — no-bypass e2e test (Important)

**File:** `apps/admin-e2e/tests/two-factor.spec.ts` (test.describe '2FA — no-bypass (email-OTP)')

**Problem:** The original test called `login.fetchOtp(SUPER_EMAIL)` which asserts `res.ok()`. Since `otp-sender.ts` returns early (`outcome: 'skipped_2fa'`) for 2FA-enrolled users without storing a code, `GET /test/last-otp?email=s@sa.io` returns 404 — causing the helper to throw and the test to fail.

**Fix:** Rewrote the test body to:
1. Navigate to `/login/code` and submit `s@sa.io`'s email via the existing `requestCode()` helper (which only awaits `otp-sent` to appear — the backend returns neutral 200 regardless).
2. Directly call `page.request.get(AUTH_SERVER_URL + '/test/last-otp?email=...')` and assert `expect(res.status()).toBe(404)` — proving no code was issued.
3. Updated the test title to "no code is issued to a 2FA-enrolled user requesting email-OTP".

## Fix 2 — verifyOtp defense-in-depth (Important)

**Files:**
- `apps/admin/app/login/actions.ts` — `verifyOtp` function
- `apps/admin/app/login/login-otp-form.tsx` — form component

**Problem:** `verifyOtp` forwarded the session cookie unconditionally on `res.ok`, with no check for `twoFactorRedirect`. If a 2FA-enrolled user somehow held a still-valid pre-enrollment OTP, redeeming it would create a full session instead of routing to the TOTP challenge.

**Fix in actions.ts:**
- Widened return type to `Promise<{ error?: string } | { twoFactor: true }>`.
- After `res.ok`, reads body via `res.clone().json()` guarded in try/catch.
- If `body.twoFactorRedirect === true`: forwards `better-auth.two_factor` cookie and returns `{ twoFactor: true }` (no session set).
- All existing behavior preserved for the non-2FA path.

**Fix in login-otp-form.tsx:**
- Added `useRouter` import.
- Widened `useActionState` type parameter to `{ error?: string } | { twoFactor: true }`.
- In the verify action callback: checks `'twoFactor' in result && result.twoFactor` → calls `router.push('/login/two-factor?next=...')`, exactly mirroring `login-form.tsx`.
- Fixed error display guard from `verifyState?.error` to `'error' in verifyState && verifyState.error` to satisfy TypeScript with the widened union type.

## Verification

- `pnpm --filter @sassy-auth/admin-e2e exec playwright test two-factor --list` — 10 tests, no errors.
- `pnpm --filter @sassy-auth/admin build` — compiled successfully, no type errors.
- `pnpm --filter @sassy-auth/auth-server exec jest` — 474 passed, 51 suites.
