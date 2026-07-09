# OAuth Authorize Error Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw JSON 4xx body that `/api/token/oauth/authorize` returns on misconfiguration with a 302 redirect to a styled admin-app error page that explains the failure, links back to `/login`, and surfaces a configurable "Contact administrator" mailto.

**Architecture:** Two surfaces. Auth-server (NestJS) wraps the `oauthAuthorize` controller in a try/catch that translates 4xx `HttpException`s into a 302 to `${ADMIN_URL}/oauth-error?code=<TokenErrorCode>&app=<clientId>`. Admin (Next.js) gets a new public `/oauth-error` route that reads `?code=` + `?app=` and renders a localized card with two CTAs. JSON fallback is preserved when `ADMIN_URL` is unset.

**Tech Stack:** NestJS 10 (Express adapter), Next.js 15 App Router, next-intl 3, `@sassy-auth/ui` (Card/Button), Jest, ts-jest, Supertest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-18-oauth-error-page-design.md`.

---

## File Map

### Created

| Path | Responsibility |
|------|----------------|
| `apps/auth-server/src/token/oauth-error-redirect.ts` | Pure helpers: `extractTokenErrorCode(err)` and `buildOauthErrorRedirectUrl(adminUrl, code, clientId?)`. No Nest dependency. |
| `apps/auth-server/src/token/oauth-error-redirect.spec.ts` | Unit tests for the two helpers. |
| `apps/admin/app/oauth-error/page.tsx` | Server component. Reads `searchParams`, resolves localized strings, renders the card. Public route (no auth guard). |
| `apps/admin/app/oauth-error/oauth-error-actions.tsx` | Client component. Renders "Return to sign-in" link and optional "Contact administrator" mailto. Reads `process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` (Next.js inlines at build time). |
| `apps/admin/app/oauth-error/__tests__/page.test.tsx` | RTL tests for the page + actions. |

### Modified

| Path | Lines (approx) | Change |
|------|---------------|--------|
| `apps/auth-server/src/token/token.controller.ts` | 55–130 | Wrap `oauthAuthorize` body in try/catch; on 4xx `HttpException` other than `UnauthorizedException`, return `{ url: <admin error URL>, statusCode: 302 }`. Fall back to rethrow when `ADMIN_URL` unset. |
| `apps/auth-server/test/app.e2e-spec.ts` | 202+ | Add `OAuth authorize error redirect` describe block with two cases (redirect when `ADMIN_URL` set; JSON when unset). |
| `apps/admin/middleware.ts` | 3 | Add `/oauth-error` to `PUBLIC_PATHS`. |
| `apps/admin/messages/en.json` | end of file | Add `oauthError` namespace keyed by `TokenErrorCode` values plus `unknown` fallback and CTA labels. |
| `apps/admin/messages/fr.json` | end of file | Same keys, FR strings (flag for human review in PR description). |
| `.env.example` | admin console section | Add `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` documented. |
| `README.md` | "Admin console" env-vars table | Add `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` row. |

---

## Task 1: Auth-server error-redirect helper

**Files:**
- Create: `apps/auth-server/src/token/oauth-error-redirect.ts`
- Create: `apps/auth-server/src/token/oauth-error-redirect.spec.ts`

### Why

Keep the URL-building and error-code-extraction logic in pure functions that can be unit-tested without bootstrapping Nest. Controller changes then only need to call these helpers.

### Step 1.1: Write the failing test file

- [ ] Create `apps/auth-server/src/token/oauth-error-redirect.spec.ts` with the following content:

```ts
import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';
import { buildOauthErrorRedirectUrl, extractTokenErrorCode } from './oauth-error-redirect';

describe('extractTokenErrorCode', () => {
  it.each([
    [TokenErrorCode.INVALID_REQUEST],
    [TokenErrorCode.APP_NOT_FOUND],
    [TokenErrorCode.INVALID_REDIRECT_URI],
    [TokenErrorCode.USER_NOT_FOUND],
    [TokenErrorCode.USER_ORG_MISMATCH],
  ])('returns the code embedded in an HttpException message (%s)', (code) => {
    const err = new BadRequestException(code);
    expect(extractTokenErrorCode(err)).toBe(code);
  });

  it('returns null for UnauthorizedException', () => {
    expect(extractTokenErrorCode(new UnauthorizedException())).toBeNull();
  });

  it('returns null for unrecognized exception messages', () => {
    expect(extractTokenErrorCode(new ForbiddenException('not_a_token_error_code'))).toBeNull();
  });

  it('returns null for non-Http errors', () => {
    expect(extractTokenErrorCode(new Error('boom'))).toBeNull();
    expect(extractTokenErrorCode(null)).toBeNull();
    expect(extractTokenErrorCode(undefined)).toBeNull();
  });

  it('reads code from response.message when Nest wraps the message in an object', () => {
    // Nest's HttpException constructor accepts (string | object). When a NotFoundException
    // receives a string, getResponse() returns { statusCode, message, error }.
    const err = new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
    expect(extractTokenErrorCode(err)).toBe(TokenErrorCode.APP_NOT_FOUND);
  });
});

describe('buildOauthErrorRedirectUrl', () => {
  it('builds a URL pointing at /oauth-error with the code in the query string', () => {
    const url = buildOauthErrorRedirectUrl('http://localhost:3001', TokenErrorCode.INVALID_REDIRECT_URI, '84LRe');
    expect(url).toBe('http://localhost:3001/oauth-error?code=invalid_redirect_uri&app=84LRe');
  });

  it('omits the app param when clientId is undefined', () => {
    const url = buildOauthErrorRedirectUrl('http://localhost:3001', TokenErrorCode.INVALID_REQUEST);
    expect(url).toBe('http://localhost:3001/oauth-error?code=invalid_request');
  });

  it('strips a trailing slash on adminUrl', () => {
    const url = buildOauthErrorRedirectUrl('http://localhost:3001/', TokenErrorCode.APP_NOT_FOUND, 'abc');
    expect(url).toBe('http://localhost:3001/oauth-error?code=APP_NOT_FOUND&app=abc');
  });

  it('URL-encodes special characters in clientId', () => {
    const url = buildOauthErrorRedirectUrl('http://localhost:3001', TokenErrorCode.APP_NOT_FOUND, 'a b/c');
    expect(url).toBe('http://localhost:3001/oauth-error?code=APP_NOT_FOUND&app=a+b%2Fc');
  });
});
```

### Step 1.2: Run the test, confirm it fails

Run: `pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=oauth-error-redirect`
Expected: FAIL with `Cannot find module './oauth-error-redirect'` or equivalent.

### Step 1.3: Implement the helper

- [ ] Create `apps/auth-server/src/token/oauth-error-redirect.ts`:

```ts
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { TokenErrorCode } from '@sassy-auth/types';

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.values(TokenErrorCode));

/**
 * Pull a `TokenErrorCode` value out of an arbitrary error. Returns null when
 * the error is not an `HttpException`, is an `UnauthorizedException` (which has
 * its own login-redirect flow), or carries a message that isn't a known code.
 *
 * Nest's `HttpException` may carry the code either as a bare string message
 * (`new BadRequestException('invalid_redirect_uri')`) or as `{ message }` on
 * the response object — handle both.
 */
export function extractTokenErrorCode(err: unknown): TokenErrorCode | null {
  if (!(err instanceof HttpException)) return null;
  if (err instanceof UnauthorizedException) return null;

  const candidates: unknown[] = [err.message];
  const response = err.getResponse();
  if (typeof response === 'object' && response !== null && 'message' in response) {
    candidates.push((response as { message: unknown }).message);
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && KNOWN_CODES.has(candidate)) {
      return candidate as TokenErrorCode;
    }
  }
  return null;
}

/**
 * Build the admin-app URL that shows the OAuth error page. Caller is expected
 * to have already verified that `adminUrl` is set.
 */
export function buildOauthErrorRedirectUrl(
  adminUrl: string,
  code: TokenErrorCode,
  clientId?: string,
): string {
  const base = adminUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ code });
  if (clientId) params.set('app', clientId);
  return `${base}/oauth-error?${params.toString()}`;
}
```

### Step 1.4: Run the test, confirm it passes

Run: `pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=oauth-error-redirect`
Expected: PASS — 9 tests.

### Step 1.5: Commit

```bash
git add apps/auth-server/src/token/oauth-error-redirect.ts apps/auth-server/src/token/oauth-error-redirect.spec.ts
git commit -m "feat(auth): oauth-error-redirect helpers (extract code + build URL)"
```

---

## Task 2: Wire helper into TokenController + extend the e2e suite

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts` (lines 55–130 — the `oauthAuthorize` handler)
- Modify: `apps/auth-server/test/app.e2e-spec.ts` (after the existing `OAuth PKCE round-trip` describe at line 202+)

### Step 2.1: Write the failing e2e cases

- [ ] Open `apps/auth-server/test/app.e2e-spec.ts` and find the existing `describe('OAuth2 Authorization Code Flow', ...)` block (around line 175). Inside that describe (after the existing `OAuth PKCE round-trip` block ends around line 269), append the following new describe:

```ts
    describe('OAuth authorize error redirect', () => {
      // The authorize endpoint is browser-only. On 4xx errors, it must
      // redirect to the admin's /oauth-error page when ADMIN_URL is set,
      // and fall back to the historical JSON body when ADMIN_URL is unset.
      const ORIGINAL_ADMIN_URL = process.env.ADMIN_URL;

      afterEach(() => {
        if (ORIGINAL_ADMIN_URL === undefined) {
          delete process.env.ADMIN_URL;
        } else {
          process.env.ADMIN_URL = ORIGINAL_ADMIN_URL;
        }
      });

      it('redirects to admin /oauth-error with code+app when ADMIN_URL is set and redirect_uri origin mismatches', async () => {
        process.env.ADMIN_URL = 'http://localhost:3001';

        // Sign in to obtain a BetterAuth session — the authorize endpoint
        // requires one before it inspects the redirect_uri.
        const signInRes = await request(httpServer)
          .post('/api/auth/sign-in/email')
          .send({ email: 's@sa.io', password: 'Pass@word1234' });
        expect([200, 201]).toContain(signInRes.status);
        const cookies = (signInRes.headers['set-cookie'] as unknown as string[]) || [];
        const sessionCookie = cookies.find((c) => c.startsWith('better-auth.session_token='));
        expect(sessionCookie).toBeTruthy();

        const app = await prisma.saApp.findFirstOrThrow({ where: { isPlatform: true } });

        const res = await request(httpServer)
          .get('/api/token/oauth/authorize')
          .query({
            client_id: app.publicId,
            redirect_uri: 'http://evil.example.com/cb', // wrong origin
            code_challenge: 'x'.repeat(43),
            code_challenge_method: 'S256',
            state: 'xyz',
          })
          .set('Cookie', sessionCookie!.split(';')[0])
          .expect(302);

        const location = res.headers.location as string;
        const url = new URL(location);
        expect(url.origin + url.pathname).toBe('http://localhost:3001/oauth-error');
        expect(url.searchParams.get('code')).toBe('invalid_redirect_uri');
        expect(url.searchParams.get('app')).toBe(app.publicId);
      });

      it('returns the historical JSON 400 body when ADMIN_URL is unset', async () => {
        delete process.env.ADMIN_URL;

        const signInRes = await request(httpServer)
          .post('/api/auth/sign-in/email')
          .send({ email: 's@sa.io', password: 'Pass@word1234' });
        const cookies = (signInRes.headers['set-cookie'] as unknown as string[]) || [];
        const sessionCookie = cookies.find((c) => c.startsWith('better-auth.session_token='));

        const app = await prisma.saApp.findFirstOrThrow({ where: { isPlatform: true } });

        const res = await request(httpServer)
          .get('/api/token/oauth/authorize')
          .query({
            client_id: app.publicId,
            redirect_uri: 'http://evil.example.com/cb',
            code_challenge: 'x'.repeat(43),
            code_challenge_method: 'S256',
            state: 'xyz',
          })
          .set('Cookie', sessionCookie!.split(';')[0])
          .expect(400);

        expect(res.body.message).toBe('invalid_redirect_uri');
      });
    });
```

### Step 2.2: Run the e2e tests, confirm the new cases fail

Run: `pnpm --filter @sassy-auth/auth-server test:e2e -- --testPathPattern=app.e2e-spec -t "OAuth authorize error redirect"`
Expected: BOTH new cases FAIL (current handler still returns JSON for both scenarios).

### Step 2.3: Implement the controller wrap

- [ ] Open `apps/auth-server/src/token/token.controller.ts`. Add the import at the top:

```ts
import { HttpException, UnauthorizedException, ... } from '@nestjs/common'; // ensure HttpException is in the named imports
```

(`UnauthorizedException` is already imported. Add `HttpException` to the existing `@nestjs/common` import line at the top of the file if it isn't there.)

- [ ] Add another import for the helpers below the existing imports:

```ts
import { buildOauthErrorRedirectUrl, extractTokenErrorCode } from './oauth-error-redirect';
```

- [ ] Replace the entire `oauthAuthorize` handler body (currently lines 55–130) so that everything except the `UnauthorizedException` and unrelated exception flow is wrapped in try/catch. The new method body:

```ts
  @Get('oauth/authorize')
  @Redirect()
  async oauthAuthorize(
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('code_challenge') codeChallenge: string,
    @Query('code_challenge_method') codeChallengeMethod: string,
    @Query('state') state: string = '',
    @Req() req: Request,
  ) {
    try {
      if (!codeChallenge || codeChallengeMethod !== 'S256') {
        throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
      }

      let numericId: number;
      try {
        numericId = this.sqidService.decode(clientId);
      } catch {
        throw new BadRequestException(TokenErrorCode.APP_NOT_FOUND);
      }
      const app = await prisma.saApp.findUnique({ where: { id: numericId } });
      if (!app) {
        throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
      }

      try {
        assertRedirectUriMatchesApp(redirectUri, app.url);
      } catch (err) {
        this.logger.getWinstonLogger().warn('oauth.redirect_uri.rejected', {
          context: 'TokenController',
          appId: clientId,
          attemptedOrigin: (() => { try { return new URL(redirectUri).origin; } catch { return '<unparseable>'; } })(),
        });
        throw err;
      }

      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!session) {
        throw new UnauthorizedException();
      }

      const saUser = await prisma.saUser.findFirst({
        where: { betterAuthUserId: session.user.id },
        include: { org: true },
      });
      if (!saUser) {
        throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
      }
      if (saUser.org.appId !== app.id) {
        throw new ForbiddenException(TokenErrorCode.USER_ORG_MISMATCH);
      }

      const code = this.oauthService.generateCode(
        saUser.publicId,
        app.publicId,
        codeChallenge,
        'S256',
      );
      const url = new URL(redirectUri);
      url.searchParams.set('code', code);
      if (state) url.searchParams.set('state', state);

      this.logger.getWinstonLogger().info('OAuth authorization code issued', {
        context: 'TokenController',
        appId: clientId,
        userId: saUser.publicId,
        pkceMethod: 'S256',
        redirectUriOrigin: new URL(redirectUri).origin,
      });
      Sentry.setTag('authFlow', 'oauth');
      Sentry.setTag('appId', clientId);

      return { url: url.toString(), statusCode: 302 };
    } catch (err) {
      // UnauthorizedException keeps the existing login-redirect flow — Nest's
      // global filter handles it. Anything not Http (5xx programming errors)
      // also propagates so Sentry sees it.
      if (err instanceof UnauthorizedException) throw err;
      if (!(err instanceof HttpException)) throw err;
      const status = err.getStatus();
      if (status < 400 || status >= 500) throw err;

      const adminUrl = process.env.ADMIN_URL;
      const code = extractTokenErrorCode(err);
      if (!adminUrl || !code) throw err; // fall back to JSON

      return {
        url: buildOauthErrorRedirectUrl(adminUrl, code, clientId),
        statusCode: 302,
      };
    }
  }
```

### Step 2.4: Re-run the e2e cases, confirm they pass

Run: `pnpm --filter @sassy-auth/auth-server test:e2e -- --testPathPattern=app.e2e-spec -t "OAuth authorize error redirect"`
Expected: BOTH new cases PASS.

Also re-run the full PKCE round-trip block to confirm we didn't regress the happy path:

Run: `pnpm --filter @sassy-auth/auth-server test:e2e -- --testPathPattern=app.e2e-spec -t "OAuth PKCE"`
Expected: PASS — existing round-trip + kid assertion intact.

### Step 2.5: Run the helper unit tests once more to confirm cross-file types still align

Run: `pnpm --filter @sassy-auth/auth-server test -- --testPathPattern=oauth-error-redirect`
Expected: PASS.

### Step 2.6: Commit

```bash
git add apps/auth-server/src/token/token.controller.ts apps/auth-server/test/app.e2e-spec.ts
git commit -m "feat(auth): 302-redirect authorize errors to admin /oauth-error when ADMIN_URL set"
```

---

## Task 3: Admin middleware — allow `/oauth-error` as a public route

**Files:**
- Modify: `apps/admin/middleware.ts:3`

### Why

The admin `middleware.ts` redirects every non-public path to `/login`. The OAuth error page must be reachable for users with no admin session (e.g. an external app's user who saw the error during the authorize redirect), so add it to `PUBLIC_PATHS`.

### Step 3.1: Update the public paths constant

- [ ] Open `apps/admin/middleware.ts` and change line 3:

```ts
const PUBLIC_PATHS = ['/login', '/accept-invite', '/oauth-error']
```

### Step 3.2: Confirm the admin build still type-checks

Run: `pnpm --filter @sassy-auth/admin exec tsc --noEmit`
Expected: PASS — no type errors.

### Step 3.3: Commit

```bash
git add apps/admin/middleware.ts
git commit -m "feat(admin): allow /oauth-error as a public route"
```

---

## Task 4: i18n strings — `oauthError` namespace in en + fr

**Files:**
- Modify: `apps/admin/messages/en.json` (append a new top-level `oauthError` namespace)
- Modify: `apps/admin/messages/fr.json` (same shape)

### Step 4.1: Add the English strings

- [ ] Open `apps/admin/messages/en.json`. Find the closing `}` of the file. Add a comma after the last existing top-level entry and insert this `oauthError` block as a new sibling top-level key (before the closing `}`):

```json
  "oauthError": {
    "pageTitle": "Authorization error — SassyAuth",
    "fallbackHeading": "Authorization request rejected",
    "fallbackBody": "SassyAuth couldn't process the authorization request.",
    "fallbackHint": "Contact a platform administrator with the URL you tried to load.",
    "appLabel": "Application ID:",
    "actions": {
      "returnToSignIn": "Return to sign-in",
      "contactAdministrator": "Contact administrator"
    },
    "codes": {
      "invalid_request": {
        "heading": "Authorization request rejected",
        "body": "The request is missing PKCE parameters or used an unsupported challenge method.",
        "hint": "The client must send code_challenge and code_challenge_method=S256."
      },
      "APP_NOT_FOUND": {
        "heading": "Application not found",
        "body": "The requesting application isn't registered with SassyAuth.",
        "hint": "Verify the client_id (a Sqid) matches a row in the Apps list."
      },
      "invalid_redirect_uri": {
        "heading": "Redirect URL doesn't match",
        "body": "The redirect URL the application sent doesn't match the URL registered for it.",
        "hint": "Open Apps, find this row, and update URL so its origin matches the redirect endpoint."
      },
      "USER_NOT_FOUND": {
        "heading": "Account not provisioned",
        "body": "Your sign-in succeeded, but no SassyAuth account is linked to it.",
        "hint": "Ask a platform admin to create a SassyAuth user record for your email and assign you to an org."
      },
      "USER_ORG_MISMATCH": {
        "heading": "Not authorized for this application",
        "body": "Your account is provisioned in SassyAuth but isn't scoped to the application you tried to access.",
        "hint": "Ask a platform admin to add you to an org associated with this application."
      }
    }
  }
```

(Note: code keys match the literal `TokenErrorCode` enum **values** as they appear in `packages/types/index.ts:23-32` — some are lowercase OAuth-style strings, some are SHOUTY_CASE. The page will look them up verbatim from the URL query string.)

### Step 4.2: Add the French strings

- [ ] Open `apps/admin/messages/fr.json` and add the same shape with French copy:

```json
  "oauthError": {
    "pageTitle": "Erreur d'autorisation — SassyAuth",
    "fallbackHeading": "Demande d'autorisation rejetée",
    "fallbackBody": "SassyAuth n'a pas pu traiter la demande d'autorisation.",
    "fallbackHint": "Contactez un administrateur de la plateforme en lui indiquant l'URL sur laquelle vous êtes tombé.",
    "appLabel": "Identifiant de l'application :",
    "actions": {
      "returnToSignIn": "Retour à la connexion",
      "contactAdministrator": "Contacter l'administrateur"
    },
    "codes": {
      "invalid_request": {
        "heading": "Demande d'autorisation rejetée",
        "body": "La requête est incomplète ou utilise une méthode de challenge PKCE non prise en charge.",
        "hint": "Le client doit envoyer code_challenge et code_challenge_method=S256."
      },
      "APP_NOT_FOUND": {
        "heading": "Application introuvable",
        "body": "L'application qui a initié la requête n'est pas enregistrée dans SassyAuth.",
        "hint": "Vérifiez que le client_id (un Sqid) correspond à une ligne de la liste des applications."
      },
      "invalid_redirect_uri": {
        "heading": "L'URL de redirection ne correspond pas",
        "body": "L'URL de redirection envoyée par l'application ne correspond pas à celle enregistrée pour cette application.",
        "hint": "Ouvrez Applications, trouvez cette ligne et modifiez l'URL pour que son origine corresponde au point de terminaison de redirection."
      },
      "USER_NOT_FOUND": {
        "heading": "Compte non provisionné",
        "body": "Votre connexion a réussi, mais aucun compte SassyAuth n'y est associé.",
        "hint": "Demandez à un administrateur de créer un utilisateur SassyAuth pour votre adresse e-mail et de l'assigner à une organisation."
      },
      "USER_ORG_MISMATCH": {
        "heading": "Accès non autorisé à cette application",
        "body": "Votre compte SassyAuth existe mais n'est pas rattaché à l'application demandée.",
        "hint": "Demandez à un administrateur de vous ajouter à une organisation associée à cette application."
      }
    }
  }
```

> Flag in the PR description: French copy was authored by Claude and warrants a human translation pass.

### Step 4.3: Sanity-check the JSON parses

Run: `node -e "require('./apps/admin/messages/en.json'); require('./apps/admin/messages/fr.json'); console.log('ok')"`
Expected: `ok` printed. (No `SyntaxError` from a misplaced comma.)

### Step 4.4: Commit

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): i18n strings for oauthError namespace (en + fr)"
```

---

## Task 5: Admin `/oauth-error` page + client actions + RTL tests

**Files:**
- Create: `apps/admin/app/oauth-error/page.tsx`
- Create: `apps/admin/app/oauth-error/oauth-error-actions.tsx`
- Create: `apps/admin/app/oauth-error/__tests__/page.test.tsx`

### Step 5.1: Write the failing RTL test file

- [ ] Create `apps/admin/app/oauth-error/__tests__/page.test.tsx`:

```tsx
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import OauthErrorPage from '../page'

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

// `page.tsx` is an async server component. Calling it like a function returns
// a Promise<JSX.Element>; resolve it before rendering.
async function renderPage(searchParams: Record<string, string | undefined>) {
  const element = await OauthErrorPage({
    searchParams: Promise.resolve(searchParams),
  })
  return render(withIntl(element))
}

describe('OauthErrorPage', () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL
    } else {
      process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL = ORIGINAL_ENV
    }
  })

  it('renders the localized heading + body for a known code', async () => {
    await renderPage({ code: 'invalid_redirect_uri', app: '84LRe' })
    expect(
      screen.getByText(en.oauthError.codes.invalid_redirect_uri.heading),
    ).toBeInTheDocument()
    expect(
      screen.getByText(en.oauthError.codes.invalid_redirect_uri.body),
    ).toBeInTheDocument()
    expect(
      screen.getByText(en.oauthError.codes.invalid_redirect_uri.hint),
    ).toBeInTheDocument()
    expect(screen.getByText('84LRe')).toBeInTheDocument()
  })

  it('falls back to the generic message when code is missing', async () => {
    await renderPage({})
    expect(
      screen.getByText(en.oauthError.fallbackHeading),
    ).toBeInTheDocument()
    expect(
      screen.getByText(en.oauthError.fallbackBody),
    ).toBeInTheDocument()
  })

  it('falls back to the generic message when code is unknown', async () => {
    await renderPage({ code: 'totally_made_up' })
    expect(
      screen.getByText(en.oauthError.fallbackHeading),
    ).toBeInTheDocument()
  })

  it('renders the "Return to sign-in" link pointing at /login', async () => {
    await renderPage({ code: 'invalid_redirect_uri' })
    const link = screen.getByRole('link', { name: en.oauthError.actions.returnToSignIn })
    expect(link).toHaveAttribute('href', '/login')
  })

  it('hides the contact link when NEXT_PUBLIC_ADMIN_CONTACT_EMAIL is unset', async () => {
    delete process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL
    await renderPage({ code: 'invalid_redirect_uri' })
    expect(
      screen.queryByRole('link', { name: en.oauthError.actions.contactAdministrator }),
    ).toBeNull()
  })

  it('renders the contact mailto with subject + body when NEXT_PUBLIC_ADMIN_CONTACT_EMAIL is set', async () => {
    process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL = 'admin@example.com'
    await renderPage({ code: 'invalid_redirect_uri', app: '84LRe' })
    const link = screen.getByRole('link', { name: en.oauthError.actions.contactAdministrator })
    const href = link.getAttribute('href') ?? ''
    expect(href.startsWith('mailto:admin@example.com')).toBe(true)
    expect(href).toContain('subject=')
    expect(decodeURIComponent(href)).toContain('invalid_redirect_uri')
    expect(decodeURIComponent(href)).toContain('84LRe')
  })
})
```

### Step 5.2: Run the test, confirm it fails

Run: `pnpm --filter @sassy-auth/admin test -- --testPathPattern=oauth-error`
Expected: FAIL — `Cannot find module '../page'`.

### Step 5.3: Implement the server page

- [ ] Create `apps/admin/app/oauth-error/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import en from '@/messages/en.json'
import { OauthErrorActions } from './oauth-error-actions'

export const dynamic = 'force-dynamic'

const KNOWN_CODES = new Set(Object.keys(en.oauthError.codes))

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('oauthError')
  return { title: t('pageTitle') }
}

type SearchParams = Promise<{ code?: string; app?: string }>

export default async function OauthErrorPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const code = params.code
  const app = params.app
  const t = await getTranslations('oauthError')

  const isKnown = typeof code === 'string' && KNOWN_CODES.has(code)
  const heading = isKnown
    ? t(`codes.${code}.heading` as 'codes.invalid_request.heading')
    : t('fallbackHeading')
  const body = isKnown
    ? t(`codes.${code}.body` as 'codes.invalid_request.body')
    : t('fallbackBody')
  const hint = isKnown
    ? t(`codes.${code}.hint` as 'codes.invalid_request.hint')
    : t('fallbackHint')

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <h1 className="text-headline-sm text-[var(--foreground)]">{heading}</h1>
        <p className="mt-3 text-body-md text-[var(--foreground)]">{body}</p>
        <p className="mt-2 text-body-sm text-[var(--muted-foreground)]">{hint}</p>

        {app ? (
          <p className="mt-4 text-label-md text-[var(--muted-foreground)]">
            {t('appLabel')} <code className="font-mono">{app}</code>
          </p>
        ) : null}

        <OauthErrorActions code={isKnown ? code : 'unknown'} app={app} />
      </div>
    </div>
  )
}
```

### Step 5.4: Implement the client actions component

- [ ] Create `apps/admin/app/oauth-error/oauth-error-actions.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'

type Props = {
  code: string
  app: string | undefined
}

export function OauthErrorActions({ code, app }: Props) {
  const t = useTranslations('oauthError.actions')
  // Next.js inlines NEXT_PUBLIC_* env vars at build time, so reading via
  // process.env from a client component works without any extra wiring.
  const contactEmail = process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL

  const mailtoHref = contactEmail
    ? `mailto:${contactEmail}?subject=${encodeURIComponent(
        `SassyAuth authorization error: ${code}`,
      )}&body=${encodeURIComponent(
        [
          `I received the following authorization error from SassyAuth:`,
          ``,
          `Error code: ${code}`,
          app ? `Application ID: ${app}` : null,
          ``,
          `Please advise.`,
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
      )}`
    : null

  return (
    <div className="mt-6 flex flex-col gap-2">
      <Link href="/login" className="w-full">
        <Button className="w-full">{t('returnToSignIn')}</Button>
      </Link>
      {mailtoHref ? (
        <a href={mailtoHref} className="text-center text-label-md text-[var(--primary)] underline-offset-4 hover:underline">
          {t('contactAdministrator')}
        </a>
      ) : null}
    </div>
  )
}
```

### Step 5.5: Run the test, confirm it passes

Run: `pnpm --filter @sassy-auth/admin test -- --testPathPattern=oauth-error`
Expected: PASS — 6 tests.

### Step 5.6: Type-check the admin app

Run: `pnpm --filter @sassy-auth/admin exec tsc --noEmit`
Expected: PASS — no type errors.

### Step 5.7: Manual smoke test

Run: `pnpm dev` (both servers).

Browser:
1. Open `http://localhost:3001/oauth-error?code=invalid_redirect_uri&app=84LRe`.
   - Expect: the styled card with `"Redirect URL doesn't match"`, the body + hint, the app code, the "Return to sign-in" button, and no mailto link (env var unset in dev).
2. Add `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL=admin@example.com` to `.env.local` and restart admin. Re-open.
   - Expect: "Contact administrator" mailto link is now visible. Clicking opens the mail client with the pre-filled subject + body.
3. Open `http://localhost:3001/oauth-error` (no params).
   - Expect: fallback heading + body.

### Step 5.8: Commit

```bash
git add apps/admin/app/oauth-error/page.tsx \
        apps/admin/app/oauth-error/oauth-error-actions.tsx \
        apps/admin/app/oauth-error/__tests__/page.test.tsx
git commit -m "feat(admin): /oauth-error page with localized error map and configurable mailto"
```

---

## Task 6: Document `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL`

**Files:**
- Modify: `.env.example` (root)
- Modify: `README.md` (root)

### Step 6.1: Add the variable to `.env.example`

- [ ] Open `.env.example`. Find the line `ADMIN_URL=http://localhost:3001` (currently around line 26). Add immediately after the trailing-blank-line that follows it:

```bash
# Email address shown in the "Contact administrator" mailto link on the admin
# /oauth-error page. Leave blank to hide the link entirely. The NEXT_PUBLIC_
# prefix is required so Next.js inlines the value into the client bundle.
NEXT_PUBLIC_ADMIN_CONTACT_EMAIL=
```

### Step 6.2: Add the row to the admin-console env-vars table in `README.md`

- [ ] Open `README.md`. Locate the `### Admin console` env-vars table (currently around line 216-221). Append a new row to the table:

```md
| `NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` | Optional. Email address shown on the admin `/oauth-error` page's "Contact administrator" mailto. Leave unset to hide the link. The `NEXT_PUBLIC_` prefix is required so Next.js inlines it into the client bundle. |
```

(Keep the existing two columns: variable name + description.)

### Step 6.3: Commit

```bash
git add .env.example README.md
git commit -m "docs: document NEXT_PUBLIC_ADMIN_CONTACT_EMAIL for the OAuth error page"
```

---

## Self-review (notes for the implementer)

- Spec coverage:
  - In-scope items 1 (auth-server wrap) → Task 2.
  - Item 2 (error-code normalization helper) → Task 1.
  - Item 3 (admin `/oauth-error` route, public, no auth guard) → Tasks 3 + 5.
  - Item 4 (Contact administrator mailto, env-driven) → Task 5 (rendering) + Task 6 (env docs).
  - Item 5 (`oauthError` namespace en + fr) → Task 4.
  - Item 6 (`NEXT_PUBLIC_ADMIN_CONTACT_EMAIL` documented) → Task 6.
  - Item 7 (auth-server e2e for redirect + JSON fallback) → Task 2.
  - Item 8 (admin RTL tests for known/unknown/contact-set/contact-unset) → Task 5.
- Type consistency: helper name `extractTokenErrorCode` used in Task 1 spec, helper file, Task 2 controller import, and consumer code — verified spelled identically in all four. `buildOauthErrorRedirectUrl` likewise.
- No placeholders: every code block is full, every command has an expected output, no "TBD" or "similar to" hand-waving.
- Failure modes the implementer might trip on:
  - The e2e test toggles `process.env.ADMIN_URL` between cases. Restore in `afterEach` is explicit. If the suite runs with a populated `.env` that already sets `ADMIN_URL`, the `ORIGINAL_ADMIN_URL` snapshot at describe-load time captures it.
  - The page uses `as` type assertions on the `t(...)` key strings because next-intl's typed translation keys don't know about dynamic template-literal keys. This keeps it compiling without disabling type safety on the rest of the file.
