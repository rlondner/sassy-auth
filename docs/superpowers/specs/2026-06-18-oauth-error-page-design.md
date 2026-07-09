# OAuth Authorize Error Page — Design Spec

**Date:** 2026-06-18
**Author:** brainstorming session (Claude + user)
**Related prior specs:** `2026-05-25-data-model-core-auth-design.md` (TokenErrorCode catalog), `2026-05-27-apps-admin-ui-design.md` (admin app conventions)

## 1. Goal

Stop showing raw NestJS JSON error bodies (e.g. `{"statusCode":400,"message":"invalid_redirect_uri",...}`) to users who land on the `/api/token/oauth/authorize` endpoint after a misconfiguration. Replace the JSON response with a 302 redirect to a styled admin-app error page that explains what went wrong in plain language, surfaces an actionable "Return to sign-in" CTA, and exposes a configurable "Contact administrator" mailto link.

## 2. Scope

### In scope

- **Auth-server (`apps/auth-server`)**: wrap the `oauthAuthorize` controller body so any thrown 4xx `HttpException` (other than `UnauthorizedException`, which keeps the existing login redirect) is translated into a 302 redirect to `${ADMIN_URL}/oauth-error?code=<TokenErrorCode>&app=<clientId>`. Falls back to the existing JSON behavior if `ADMIN_URL` is unset (dev safety net) or if the request lacks a sensible browser-redirect target.
- **Auth-server**: error-code normalization helper so every code passed in the redirect query string is a value from `TokenErrorCode` (no leaked internal strings, no PII).
- **Admin (`apps/admin`)**: new public route at `/oauth-error` (no auth guard — the user may not be signed in). Reads `?code=` and `?app=` from the query string, maps `code` to a localized message via `next-intl`, renders a card with heading + body + bullet list of "what to check" + CTAs.
- **Admin**: render a "Contact administrator" link only when `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` is set. The link is a `mailto:` with a pre-filled subject and body that include the error code and the app id when available.
- **Admin**: new `oauthError` namespace in `apps/admin/messages/en.json` and `apps/admin/messages/fr.json`, keyed by `TokenErrorCode` values plus a `unknown` fallback.
- **Env**: add `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` to `.env.example`. Update the root README env-var table.
- **Tests (auth-server)**: extend the existing PKCE e2e suite to assert that an authorize call with a mismatched `redirect_uri` returns a 302 with `Location` matching `${ADMIN_URL}/oauth-error?code=invalid_redirect_uri&app=<clientId>`, and that with `ADMIN_URL` unset it still returns the JSON body (back-compat).
- **Tests (admin)**: unit test (Jest + React Testing Library, matching the conventions in `apps/admin/components/__tests__/`) that renders the page for a known code, an unknown code, and with the contact email both set and unset.

### Explicitly NOT in scope

- The token-exchange endpoint (`POST /api/token/oauth/token`). It is server-to-server and JSON is the right response shape. No changes.
- The direct-login endpoint (`POST /api/token/direct/login`). Same reasoning.
- The FastAPI sample's `error.html` template. It handles a different error class (PKCE state expired, token exchange transport failure) and is downstream of this work.
- Replacing `UnauthorizedException` (no BetterAuth session) on the authorize endpoint with the error page. The existing login redirect flow already covers that case correctly and is out of scope.
- Per-app contact email overrides (e.g. one mailto per `sa_app`). v1 ships a single platform-wide mailto. A per-app field on `SaApp` can come later if there is demand.
- An i18n review pass on the French strings beyond a best-effort initial translation. Flag for human review in the PR description, same convention as prior specs.
- Logging or Sentry capture changes. The existing `oauth.redirect_uri.rejected` warn log in `TokenController` (`token.controller.ts:83`) already covers observability; this work only changes the response surface.
- Styling beyond reuse of existing `@sassy-auth/ui` primitives (Card, Button). No new design tokens.

## 3. Architecture

### Data flow on the error path

```
Browser
  │ navigates to AUTH_SERVER_URL/api/token/oauth/authorize?...
  ▼
auth-server (NestJS): TokenController.oauthAuthorize
  │ catches HttpException
  ├─ UnauthorizedException → existing login redirect (no change)
  ├─ HttpException 4xx + ADMIN_URL set
  │     │ build redirectErrorUrl(code, clientId)
  │     ▼
  │   302 → ${ADMIN_URL}/oauth-error?code=<code>&app=<clientId>
  └─ HttpException 4xx + ADMIN_URL unset
        │ rethrow → existing JSON 4xx body (back-compat fallback)
        ▼
admin (Next.js): app/oauth-error/page.tsx
  │ reads ?code and ?app
  │ resolves localized strings via next-intl
  ▼
Rendered card with CTAs
```

### Layering

- New auth-server helper file `apps/auth-server/src/token/oauth-error-redirect.ts` exporting two functions:
  - `extractTokenErrorCode(err: unknown): TokenErrorCode | null` — pull a known code out of an `HttpException`'s `message` (the existing throws pass `TokenErrorCode.X` as the exception message, see `token.controller.ts:66`, `:73`, `:88`, `:103`, `:106`).
  - `buildOauthErrorRedirectUrl(adminUrl: string, code: TokenErrorCode, clientId?: string): string` — URL-builds the redirect target with `URL` + `searchParams.set` so encoding is correct.

  Pure functions, fully unit-testable, no Nest dependency surface.

- `TokenController.oauthAuthorize` is wrapped in a `try { ... } catch` that:
  1. Lets `UnauthorizedException` propagate (existing behavior).
  2. Lets non-HttpException errors propagate (5xx still goes through the existing exception filters → Sentry).
  3. For `HttpException` with status `>= 400 && < 500`: calls `extractTokenErrorCode`; if `ADMIN_URL` is set, returns `{ url: redirectUrl, statusCode: 302 }` via the existing `@Redirect()` decorator pattern. If `ADMIN_URL` is unset, rethrows so the JSON path still works.

- Admin route lives at `apps/admin/app/oauth-error/page.tsx`. It is a server component that reads `searchParams` and passes the resolved strings down to a small client component for the CTA buttons. Keeps the page server-rendered while letting buttons use client-side navigation. No auth guard — the page is reachable without a session.

- i18n entries are loaded via the existing `getTranslations` flow used by other admin pages.

### Error code → UI mapping

The authorize endpoint throws these `TokenErrorCode` values today (grep of `token.controller.ts` and `token.service.ts`):

| `TokenErrorCode`        | HTTP status | UI heading                          | UI body (plain English)                                                                  | "What to check" bullets                                                                              |
|-------------------------|-------------|-------------------------------------|------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| `invalid_request`       | 400         | Authorization request rejected      | The request is missing PKCE parameters or used an unsupported challenge method.          | The client must send `code_challenge` and `code_challenge_method=S256`.                              |
| `app_not_found`         | 404         | Application not found               | The requesting application isn't registered with SassyAuth.                              | Verify the `client_id` (a Sqid) matches a row in the **Apps** list.                                  |
| `invalid_redirect_uri`  | 400         | Redirect URL doesn't match          | The redirect URL the application sent doesn't match the URL registered for it.           | Open **Apps**, find this row, and update **URL** so its origin matches the app's redirect endpoint.  |
| `user_not_found`        | 403         | Account not provisioned             | Your sign-in succeeded, but no SassyAuth account is linked to it.                         | Ask a platform admin to create a SassyAuth user record for your email and assign you to an org.      |
| `user_org_mismatch`     | 403         | Not authorized for this application | Your account is provisioned in SassyAuth but isn't scoped to the application you tried to access. | Ask a platform admin to add you to an org that's associated with this application.                   |
| _unknown / unmapped_    | —           | Authorization request rejected      | SassyAuth couldn't process the authorization request.                                    | Contact a platform admin with the URL you tried to load.                                             |

The "Return to sign-in" CTA always goes to `/login` (no `next` param — the original next URL is part of what failed, replaying it would re-trigger the same error).

The "Contact administrator" link is rendered only if `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` is set at build time. Subject is `"SassyAuth authorization error: <code>"` and body includes the error code and (if present) the `app` query parameter.

### Configuration

| Variable                          | Where      | Description                                                                                                              |
|-----------------------------------|------------|--------------------------------------------------------------------------------------------------------------------------|
| `ADMIN_URL`                       | auth-server | Already required for invitation URLs. Reused here to build the redirect target. If unset, the error path falls back to JSON. |
| `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` | admin (browser) | New. Email address shown in the "Contact administrator" mailto. Optional — link hides if unset.                          |

`NEXT_PUBLIC_` prefix is required so Next.js ships it into the browser bundle.

## 4. Components

### Auth-server

- `apps/auth-server/src/token/oauth-error-redirect.ts` (new): pure helpers described in §3 Layering.
- `apps/auth-server/src/token/oauth-error-redirect.spec.ts` (new): unit tests for the two helpers.
- `apps/auth-server/src/token/token.controller.ts`: wrap `oauthAuthorize` in a try/catch that uses the helpers. No other endpoints change.

### Admin

- `apps/admin/app/oauth-error/page.tsx` (new): server component, reads `searchParams`, renders the card via `@sassy-auth/ui` primitives.
- `apps/admin/app/oauth-error/oauth-error-actions.tsx` (new): small client component that renders the two CTA buttons (`Return to sign-in`, `Contact administrator`). Reads `process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` (Next.js inlines this at build time) and hides the mailto link when unset.
- `apps/admin/app/oauth-error/__tests__/page.test.tsx` (new): RTL tests.
- `apps/admin/messages/en.json` and `apps/admin/messages/fr.json`: add the `oauthError` namespace.

### Root

- `.env.example`: document `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` under the admin console section.
- `README.md`: add `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` to the admin-console env-var table.

## 5. Tests

### Auth-server

- Unit (`oauth-error-redirect.spec.ts`):
  - `extractTokenErrorCode` returns the right `TokenErrorCode` for an `HttpException` whose `message` is one of the catalogued values; returns `null` for `UnauthorizedException` and for unrecognized messages.
  - `buildOauthErrorRedirectUrl` URL-encodes `code` and `app` correctly; tolerates `clientId` missing; trims a trailing slash on `adminUrl`.

- E2E (extend `apps/auth-server/test/app.e2e-spec.ts` PKCE block):
  - With `ADMIN_URL=http://localhost:3001`: a GET to `/api/token/oauth/authorize` carrying a non-matching `redirect_uri` returns 302 with `Location` exactly `http://localhost:3001/oauth-error?code=invalid_redirect_uri&app=<clientId>`.
  - With `ADMIN_URL` cleared at runtime for the test, the same request returns the existing JSON 400 (`message: invalid_redirect_uri`).
  - The token-exchange test (`POST /api/token/oauth/token`) keeps returning JSON 401 — i.e. the redirect behavior is scoped to the authorize endpoint only.

### Admin

- Unit (`oauth-error/__tests__/page.test.tsx`):
  - Renders the right heading + body for each known code (parameterised).
  - Renders the `oauthError.unknown` fallback when `code` is missing or unrecognised.
  - "Return to sign-in" button links to `/login`.
  - "Contact administrator" link is hidden when `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` is unset, and visible with the correct `mailto:` URL (subject + body containing the error code and app id) when set.

### Manual smoke

After the code lands, walk through the FastAPI sample flow with a deliberately-mismatched RS `REDIRECT_URI` and verify the user lands on the new admin page (en + fr).

## 6. Out-of-scope / future work

- Per-app contact email override on the `SaApp` row.
- Server-side logging of the error → admin-page transition (existing controller-side warn log is sufficient).
- An analytics event when the error page renders.
- Replacing the JSON fallback with HTML even when `ADMIN_URL` is unset (would require a minimal template engine in auth-server).
- Surfacing `error_description` from a future spec-conformant OAuth error response.

## 7. Open questions

None — the design is fully decided. Ready to write the implementation plan.
