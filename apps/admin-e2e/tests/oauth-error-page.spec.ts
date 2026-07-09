import { test, expect } from '../lib/fixtures'
import { t } from '../lib/i18n'

// Direct rendering of the /oauth-error page. No session required — the page
// is allowlisted in apps/admin/middleware.ts so users who hit an OAuth
// failure during the authorize redirect can see it without being signed in.
test.describe('OAuth error page (unauthenticated render)', () => {
  test('renders the localized heading, body, hint, and app id for a known code', async ({ page }) => {
    const APP_ID = '84LRe'
    await page.goto(`/oauth-error?code=invalid_redirect_uri&app=${APP_ID}`)
    await expect(page).toHaveURL(/\/oauth-error/)

    await expect(
      page.getByRole('heading', { name: t('oauthError.codes.invalid_redirect_uri.heading') }),
    ).toBeVisible()
    await expect(page.getByText(t('oauthError.codes.invalid_redirect_uri.body'))).toBeVisible()
    await expect(page.getByText(t('oauthError.codes.invalid_redirect_uri.hint'))).toBeVisible()
    await expect(page.getByText(APP_ID)).toBeVisible()
  })

  test('renders the fallback message when code is absent', async ({ page }) => {
    await page.goto('/oauth-error')
    await expect(
      page.getByRole('heading', { name: t('oauthError.fallbackHeading') }),
    ).toBeVisible()
    await expect(page.getByText(t('oauthError.fallbackBody'))).toBeVisible()
  })

  test('renders the fallback message when code is not in the known set', async ({ page }) => {
    await page.goto('/oauth-error?code=totally_made_up_value')
    await expect(
      page.getByRole('heading', { name: t('oauthError.fallbackHeading') }),
    ).toBeVisible()
  })

  test('renders for an unauthenticated browser without redirecting to /login', async ({ page }) => {
    // Regression: middleware.ts must keep /oauth-error in PUBLIC_PATHS so
    // users without a session can read the explanation.
    await page.goto('/oauth-error?code=invalid_redirect_uri')
    await expect(page).toHaveURL(/\/oauth-error/)
    await expect(
      page.getByRole('heading', { name: t('oauthError.codes.invalid_redirect_uri.heading') }),
    ).toBeVisible()
  })

  test('"Return to sign-in" link navigates to /login', async ({ page }) => {
    await page.goto('/oauth-error?code=invalid_redirect_uri')
    const cta = page.getByRole('link', { name: t('oauthError.actions.returnToSignIn') })
    await expect(cta).toBeVisible()
    await cta.click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('"Contact administrator" mailto is gated by NEXT_PUBLIC_ADMIN_CONTACT_EMAIL', async ({ page }) => {
    // The link is rendered only when the admin app was built with a non-empty
    // NEXT_PUBLIC_ADMIN_CONTACT_EMAIL. In a fresh dev environment that env
    // var is normally unset and the link is hidden. If a developer has set
    // it locally, the link must be a well-formed mailto: that includes the
    // code in the subject. Both shapes pass — this test asserts the contract,
    // not which branch you happen to be in.
    await page.goto('/oauth-error?code=invalid_redirect_uri&app=ABCD1')

    const contactLink = page.getByRole('link', { name: t('oauthError.actions.contactAdministrator') })
    const count = await contactLink.count()

    if (count === 0) {
      // Env var unset → link is hidden. Nothing else to assert.
      return
    }

    // Env var set → link must be a mailto with the code (and app, if rendered)
    // in the encoded subject or body.
    const href = await contactLink.getAttribute('href')
    expect(href).not.toBeNull()
    expect(href!.startsWith('mailto:')).toBe(true)
    const decoded = decodeURIComponent(href!)
    expect(decoded).toContain('invalid_redirect_uri')
    expect(decoded).toContain('ABCD1')
  })

  test('page <title> reflects the localized pageTitle', async ({ page }) => {
    await page.goto('/oauth-error?code=invalid_redirect_uri')
    await expect(page).toHaveTitle(t('oauthError.pageTitle'))
  })
})
