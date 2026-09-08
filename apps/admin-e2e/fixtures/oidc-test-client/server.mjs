// Minimal relying-party (RP) landing pages for oidc-round-trip.spec.ts.
//
// This is only the redirect_uri / post_logout_redirect_uri *target* — the
// place the browser lands after the auth-server issues its final 302. It
// does not participate in the OIDC exchange at all: openid-client, running
// in the Playwright test process (Node, not the browser), drives discovery,
// authorization-code exchange, userinfo, and logout directly against the
// auth-server. Without something listening on this port, the browser's
// final redirect would fail with net::ERR_CONNECTION_REFUSED and the test's
// own `page.goto(authUrl.href)` / `page.waitForURL(/\/callback\?/)` calls
// (see the brief's literal spec text) could never observe the callback URL.
import { createServer } from 'node:http'

const PORT = Number(process.env.OIDC_TEST_CLIENT_PORT ?? 3002)

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><title>oidc-test-client</title><p>${req.url}</p>`)
})

server.listen(PORT, () => {
  console.log(`[oidc-test-client] listening on :${PORT}`)
})
