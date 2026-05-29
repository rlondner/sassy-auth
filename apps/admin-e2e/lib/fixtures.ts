import { test as base } from '@playwright/test'

type DiagnosticBuckets = {
  consoleMessages: string[]
  pageErrors: string[]
  networkFailures: string[]
}

export const test = base.extend<{ diagnostics: DiagnosticBuckets }>({
  diagnostics: [
    async ({ page }, use, testInfo) => {
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
        const html = await page.content().catch(() => '<could not capture page HTML>')
        const visibleText = await page.locator('body').innerText().catch(() => null)

        await testInfo.attach('console.log', {
          body: buckets.consoleMessages.join('\n') || '(none)',
          contentType: 'text/plain',
        })
        await testInfo.attach('page-errors.log', {
          body: buckets.pageErrors.join('\n\n') || '(none)',
          contentType: 'text/plain',
        })
        await testInfo.attach('network.log', {
          body: buckets.networkFailures.join('\n') || '(none)',
          contentType: 'text/plain',
        })
        await testInfo.attach('page-snapshot.html', {
          body: html,
          contentType: 'text/html',
        })
        if (visibleText) {
          await testInfo.attach('visible-page-text.txt', {
            body: visibleText,
            contentType: 'text/plain',
          })
        }
      }
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
