# Captcha on self-serve signup — design

**Date:** 2026-09-07
**Status:** approved design, no implementation plan yet
**Scope:** add a Cloudflare Turnstile captcha to the self-serve `/signup` page
(`apps/admin/app/signup/`, built on `docs/superpowers/specs/2026-09-03-admin-signup-design.md`,
not yet merged to `dev`). No other form (`/login`, `/accept-invite`) is in scope.

---

## 1. Problem and stance

`POST /api/register` is the only unauthenticated, unthrottled-beyond-a-simple-
counter account/org-creation endpoint in the system (`registration.controller.ts`,
guarded only by `RateLimitGuard`). `/accept-invite` and `/login` both require a
prior admin-issued artifact (an invitation token, or an existing account) and
are out of scope — captcha addresses bot/scripted abuse of a fully public entry
point, which only `/signup` is.

Provider: **Cloudflare Turnstile** — free, no visible "click the traffic
lights" friction in the common case, and no existing Google dependency in this
repo to extend.

## 2. Architecture

The widget runs client-side in the signup form and produces an opaque token.
That token rides along with the rest of the form fields through the existing
`registerAction` server action to `POST /api/register`, and is verified
**server-side in `apps/auth-server`** — the only place the Cloudflare secret
key lives — as the first step of `RegistrationService.register()`, before any
BetterAuth call or DB work. An invalid or missing token is rejected before the
app-lookup/user-creation work starts.

## 3. Frontend (`apps/admin`)

- New dependency: `@marsidev/react-turnstile`. No captcha library exists in
  the repo today; this one is small and gives `onSuccess`/`onExpire`/`onError`
  callback props instead of requiring hand-rolled global-callback script
  wiring.
- **`signup-form.tsx`**: renders
  `<Turnstile siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} onSuccess={setToken} onExpire={() => setToken(null)} />`
  above the submit button. Client-side, submission is blocked with a new
  `signup.errors.captchaRequired` message if no token has been obtained yet —
  same pattern as the existing password-mismatch/tooShort/complexity checks in
  `handleSubmit`.
- **`actions.ts`**: `registerAction`'s POST body gains `turnstileToken`. The
  existing status-code → error-code mapping table gains one row:

  | Condition | Result |
  |---|---|
  | 422 | `{ error: 'captchaFailed' }` |

  (all other rows unchanged from the 2026-09-03 admin-signup design).

## 4. Backend (`apps/auth-server`)

- **`registration/register.dto.ts`**: add
  `@IsString() @MinLength(1) turnstileToken!: string;`, same validation style
  as the existing fields.
- **New `registration/turnstile.service.ts`**: one method,
  `verify(token: string): Promise<boolean>` — POSTs
  `secret=process.env.TURNSTILE_SECRET_KEY&response=<token>` to
  `https://challenges.cloudflare.com/turnstile/v0/siteverify` and returns the
  response's `.success`. This is the first raw outbound `fetch` in
  `apps/auth-server` (social login delegates entirely to BetterAuth's
  provider configs) — no existing HTTP-client wrapper to reuse, so it's a
  plain `fetch` in a try/catch, treating a transport failure as
  verification-failed (fail closed).
- **`registration.service.ts:register()`**: as its first step, call
  `turnstileService.verify(dto.turnstileToken)`. On `false`, throw
  `UnprocessableEntityException()` (422). 422 is otherwise unused by this
  endpoint, so the frontend can distinguish "captcha rejected" from the
  existing 400 (DTO validation), 404 (`appNotFound`), 409 (`emailTaken`), and
  429 (`tooManyRequests`) outcomes without inspecting response bodies.
- No client IP is forwarded to Cloudflare's `siteverify` (the `remoteip`
  field is optional) — avoids threading `@Req()` through the controller
  method signature for a non-required field.
- Ordering: `RateLimitGuard` (already on `@Post()`) still runs before the
  controller method body, so rate limiting is evaluated before captcha
  verification, unchanged from today.

## 5. Config

New `.env.example` section, following the existing `# ── Section name ──`
banner convention:

```
# ── Cloudflare Turnstile (signup captcha) ──
# Secret key, auth-server only — never exposed to the browser.
TURNSTILE_SECRET_KEY=
```

and in `apps/admin`'s env:

```
# ── Cloudflare Turnstile (signup captcha) ──
# Public site key — inlined into the client bundle by the NEXT_PUBLIC_ prefix.
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

For local dev, test, and CI, both apps use Cloudflare's documented
always-pass test keypair (`1x00000000000000000000AA` site key /
`1x0000000000000000000000000000000AA` secret key) — no network-mocking code
needed for the common case; `registration.service.spec.ts` still mocks
`global.fetch` directly for the unit-level pass/fail branches.

## 6. i18n

`apps/admin/messages/en.json`, under the existing `signup.errors` namespace,
two new keys following the existing convention (one key per distinguishable
failure mode):

- `captchaRequired` — client-side, submit attempted before the widget
  produced a token.
- `captchaFailed` — server rejected the token (expired, replayed, or
  Cloudflare verification failed).

`KNOWN_ERRORS` in `signup-form.tsx` gains `'captchaFailed'`.

## 7. Testing

- `registration.service.spec.ts`: extend the `baseDto` fixture with
  `turnstileToken`; add cases for `turnstileService.verify()` returning
  `true` (proceeds as before) and `false` (throws `UnprocessableEntityException`,
  no BetterAuth/DB calls made).
- New `turnstile.service.spec.ts`: mocks `global.fetch`, asserts the request
  shape (secret + token) and the `success` → boolean mapping, including a
  transport-failure case (fails closed).
- `signup/__tests__/signup-form.test.tsx`: mock `@marsidev/react-turnstile`'s
  `Turnstile` component; add a case asserting submission is blocked with
  `captchaRequired` until `onSuccess` fires.
- `signup/__tests__/actions.test.ts`: add the 422 → `captchaFailed` mapping
  case.

## 8. What stays unchanged

- Everything in `docs/superpowers/specs/2026-09-03-admin-signup-design.md`
  not explicitly touched above: app-lookup flow, BetterAuth sign-up call,
  duplicate-email handling, transactional org+user creation, `RateLimitGuard`/
  `AppLookupRateLimitGuard`, the `/api/register/app` name-lookup endpoint.
- `/login` and `/accept-invite` — no captcha added to either.

## 9. Explicitly out of scope

- Captcha on `/login` or `/accept-invite`.
- A score-based/invisible fallback provider if Turnstile is ever unavailable
  (single-provider only).
- Any change to `REGISTER_RATE_LIMIT`/`REGISTER_RATE_WINDOW_MS` — captcha is
  additive to existing rate limiting, not a replacement for it.
