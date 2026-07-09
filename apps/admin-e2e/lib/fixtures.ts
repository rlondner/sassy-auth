import { test as base } from '@playwright/test'

type DiagnosticBuckets = {
  consoleMessages: string[]
  pageErrors: string[]
  networkFailures: string[]
}

export const test = base.extend<{ diagnostics: DiagnosticBuckets }>({
  diagnostics: [
    async ({ page }, use, testInfo) => {
      // Disable CSS animations/transitions so Radix menus, drawers and sonner
      // toasts settle instantly. Without this, an animating toast can keep a
      // freshly-opened dropdown from ever becoming "stable" for Playwright.
      await page.addInitScript(() => {
        const css =
          '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}'
        const inject = () => {
          const style = document.createElement('style')
          style.setAttribute('data-e2e-no-animations', '')
          style.textContent = css
          document.head?.appendChild(style)
        }
        if (document.head) inject()
        else document.addEventListener('DOMContentLoaded', inject)
      })

      const buckets: DiagnosticBuckets = {
        consoleMessages: [],
        pageErrors: [],
        networkFailures: [],
      }

      page.on('console', (msg) => {
        buckets.consoleMessages.push(`[${msg.type()}] ${msg.text()}`)
      })
      page.on('pageerror', (err) => {
        buckets.pageErrors.push(`${err.name}: ${err.message}\n${err.stack ?? ''}`)
      })
      page.on('requestfailed', (req) => {
        const failure = req.failure()?.errorText ?? 'unknown'
        buckets.networkFailures.push(
          `requestfailed ${req.method()} ${req.url()} — ${failure}`,
        )
      })
      page.on('response', (res) => {
        if (res.status() >= 400) {
          buckets.networkFailures.push(
            `${res.status()} ${res.request().method()} ${res.url()}`,
          )
        }
      })

      await use(buckets)

      // After test runs, attach diagnostics on failure only.
      if (testInfo.status !== testInfo.expectedStatus) {
        async function safeAttach(name: string, body: string, contentType: string) {
          try {
            await testInfo.attach(name, { body, contentType })
          } catch {
            // best-effort: don't let one attach failure mask the others
          }
        }

        const html = await page.content().catch(() => '<could not capture page HTML>')
        const visibleText = await page.locator('body').innerText().catch(() => null)

        await safeAttach('console.log', buckets.consoleMessages.join('\n') || '(none)', 'text/plain')
        await safeAttach('page-errors.log', buckets.pageErrors.join('\n\n') || '(none)', 'text/plain')
        await safeAttach('network.log', buckets.networkFailures.join('\n') || '(none)', 'text/plain')
        await safeAttach('page-snapshot.html', html, 'text/html')
        await safeAttach(
          'visible-page-text.txt',
          visibleText ?? '<could not capture visible text>',
          'text/plain',
        )
      }
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
