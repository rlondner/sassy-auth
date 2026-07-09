import { test, expect } from '../../lib/fixtures'
import {
  ADMIN_URL,
  buildAuthorizeUrl,
  fetchAnyNonPlatformApp,
  fetchPlatformApp,
  newPkce,
} from '../../lib/oauth-fixtures'

test.describe('OAuth authorize → admin /oauth-error redirect (super-admin authed)', () => {
  // These tests assume the auth-server is running with ADMIN_URL set in its
  // environment. Without it, the controller's catch block falls back to a
  // JSON 4xx body (the historical behavior) and these tests fail because
  // the browser stays on /api/token/oauth/authorize instead of being
  // redirected to ${ADMIN_URL}/oauth-error.

  test('mismatched redirect_uri redirects to /oauth-error?code=invalid_redirect_uri&app=<id>', async ({
    page,
    request,
  }) => {
    const platformApp = await fetchPlatformApp(request)
    const { challenge } = newPkce()

    await page.goto(
      buildAuthorizeUrl({
        client_id: platformApp.publicId,
        // Wrong-origin redirect — http://localhost:8010/auth/callback is the
        // FastAPI sample's URL, intentionally NOT matching the platform app
        // URL registered in sa_app.url.
        redirect_uri: 'http://localhost:8010/auth/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'pw-state-mismatch',
      }),
    )

    const finalUrl = new URL(page.url())
    expect(finalUrl.origin).toBe(new URL(ADMIN_URL).origin)
    expect(finalUrl.pathname).toBe('/oauth-error')
    expect(finalUrl.searchParams.get('code')).toBe('invalid_redirect_uri')
    expect(finalUrl.searchParams.get('app')).toBe(platformApp.publicId)
  })

  test('non-existent client_id redirects to /oauth-error?code=APP_NOT_FOUND', async ({ page }) => {
    const { challenge } = newPkce()

    await page.goto(
      buildAuthorizeUrl({
        client_id: 'ZZZZZ', // No sa_app row has this publicId.
        redirect_uri: `${process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'}/cb`,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'pw-state-nonexistent',
      }),
    )

    const finalUrl = new URL(page.url())
    expect(finalUrl.origin).toBe(new URL(ADMIN_URL).origin)
    expect(finalUrl.pathname).toBe('/oauth-error')
    expect(finalUrl.searchParams.get('code')).toBe('APP_NOT_FOUND')
  })

  test('client_id pointing at an app the user is not scoped to redirects to /oauth-error?code=USER_ORG_MISMATCH', async ({
    page,
    request,
  }) => {
    // Models the "SASSY_CLIENT_ID points at the wrong app" scenario: the
    // RS's env was set to an app the signed-in user has no membership in
    // (different org, different sa_app row). The Sqid is valid and the app
    // exists, so the controller doesn't throw APP_NOT_FOUND — it gets all
    // the way to the org/app match check and throws USER_ORG_MISMATCH.
    //
    // Requires at least one non-platform app to exist. Run the seed with
    // SEED_DEMO=1 to provision the `resourceserver01` demo, or create any
    // non-platform app in the admin UI.
    const otherApp = await fetchAnyNonPlatformApp(request)
    test.skip(
      otherApp === null,
      'No non-platform app found via /api/apps. Run `SEED_DEMO=1 pnpm --filter @sassy-auth/auth-server seed` to provision the resourceserver01 demo, then re-run this test.',
    )

    const { challenge } = newPkce()

    await page.goto(
      buildAuthorizeUrl({
        client_id: otherApp!.publicId,
        // origin-match the non-platform app's own url so we don't trip
        // invalid_redirect_uri first.
        redirect_uri: `${otherApp!.url.replace(/\/$/, '')}/cb`,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'pw-state-org-mismatch',
      }),
    )

    const finalUrl = new URL(page.url())
    expect(finalUrl.origin).toBe(new URL(ADMIN_URL).origin)
    expect(finalUrl.pathname).toBe('/oauth-error')
    expect(finalUrl.searchParams.get('code')).toBe('USER_ORG_MISMATCH')
    expect(finalUrl.searchParams.get('app')).toBe(otherApp!.publicId)
  })

  test('missing PKCE parameters redirects to /oauth-error?code=invalid_request', async ({
    page,
    request,
  }) => {
    const platformApp = await fetchPlatformApp(request)

    await page.goto(
      buildAuthorizeUrl({
        client_id: platformApp.publicId,
        redirect_uri: `${platformApp.url.replace(/\/$/, '')}/cb`,
        // Intentionally omitting code_challenge and code_challenge_method.
        state: 'pw-state-no-pkce',
      }),
    )

    const finalUrl = new URL(page.url())
    expect(finalUrl.origin).toBe(new URL(ADMIN_URL).origin)
    expect(finalUrl.pathname).toBe('/oauth-error')
    expect(finalUrl.searchParams.get('code')).toBe('invalid_request')
  })

  test('valid authorize call redirects back to redirect_uri with a code (success path)', async ({
    page,
    request,
  }) => {
    const platformApp = await fetchPlatformApp(request)
    const { challenge } = newPkce()

    // redirect_uri shares the platform app's origin so the redirect-uri
    // origin check passes. We stub the redirect_uri origin so the test
    // doesn't depend on platformApp.url being a DNS-resolvable host — the
    // browser still ends on this URL after the 302, we just short-circuit
    // the final fetch so page.url() is observable.
    const redirectUri = `${platformApp.url.replace(/\/$/, '')}/cb`

    // Narrow the stub to exactly /cb on the redirect_uri origin. A broader
    // `${origin}/**` mock intercepts /api/token/oauth/authorize itself when
    // platformApp.url shares the auth-server's origin (BETTER_AUTH_URL=
    // http://localhost:3000 by default), so the browser never reaches the
    // real authorize endpoint and the test sits on /api/token/oauth/authorize
    // with an empty body.
    const redirectUriOrigin = new URL(redirectUri).origin
    await page.route(
      (url) => url.origin === redirectUriOrigin && url.pathname === '/cb',
      (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
    )

    await page.goto(
      buildAuthorizeUrl({
        client_id: platformApp.publicId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'pw-state-success',
      }),
    )

    const finalUrl = new URL(page.url())
    // Browser must have followed the auth-server's 302 onto the redirect_uri,
    // NOT to /oauth-error.
    expect(finalUrl.origin).toBe(new URL(platformApp.url).origin)
    expect(finalUrl.pathname).toBe('/cb')
    expect(finalUrl.searchParams.get('code'), 'authorization code must be present').toBeTruthy()
    expect(finalUrl.searchParams.get('state')).toBe('pw-state-success')
    expect(finalUrl.pathname).not.toBe('/oauth-error')
  })
})
