import { expect, type APIRequestContext, type Page } from '@playwright/test'

const STUB_IDP_URL = process.env.E2E_STUB_IDP_URL ?? 'http://localhost:9099'

export interface StubIdentity {
  sub?: string
  email: string
  email_verified?: boolean
  name?: string
}

/**
 * Drives the stub OIDC provider used by the federated e2e round-trip.
 *
 * IDENTITY SELECTION — side channel, not query params (task-13 correction):
 * fixtures/stub-idp/server.mjs documents in detail why a browser click on
 * "Continue with Test IdP" can never carry `stub_email`/`stub_sub`/
 * `stub_email_verified` through to the stub's `/authorize` endpoint —
 * BetterAuth's genericOAuth plugin builds that redirect itself from the
 * provider config, never from the sign-in request. The only mechanism that
 * actually reaches a real, browser-driven sign-in is calling
 * `POST /__set-identity` on the stub server directly (Playwright test code
 * runs in Node, not the browser) *before* clicking the button. This class
 * wraps that side channel plus the button click so specs never touch either
 * detail directly.
 */
export class SocialLoginPage {
  constructor(private readonly page: Page) {}

  /** Sets the identity the *next* stub /authorize call will hand out. */
  async setIdentity(request: APIRequestContext, identity: StubIdentity): Promise<void> {
    const res = await request.post(`${STUB_IDP_URL}/__set-identity`, { data: identity })
    expect(res.ok(), `POST /__set-identity failed: ${res.status()} ${await res.text()}`).toBeTruthy()
  }

  /**
   * Clears any pending identity, restoring the stub's hardcoded default
   * (stub-sub-1 / social@cpm.io / verified). Call this in beforeEach so a
   * test that forgets to call setIdentity gets a known identity rather than
   * whatever a previous test left pending, and in afterEach/finally so a
   * failed test never wedges the next one behind a 409.
   */
  async resetIdentity(request: APIRequestContext): Promise<void> {
    await request.post(`${STUB_IDP_URL}/__reset-identity`)
  }

  /** Clicks the "Continue with Test IdP" button rendered by the admin login page. */
  async clickTestIdp(): Promise<void> {
    const button = this.page.getByRole('button', { name: /test idp/i })
    await expect(button).toBeVisible()
    await button.click()
  }
}
