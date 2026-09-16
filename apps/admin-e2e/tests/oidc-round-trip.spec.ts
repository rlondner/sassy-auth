/**
 * Task 12 (OIDC compatibility plan) — the acceptance criterion for the whole
 * plan: a stock, unmodified `openid-client` completes discovery, authorize,
 * exchange, id_token validation, /userinfo, and RP-initiated logout against
 * the real auth-server. No `openid-client` option here exists to work around
 * SassyAuth behaviour — if one becomes necessary, the bug is in the server.
 *
 * Requires (see apps/admin-e2e/README or playwright.config.ts for the CI
 * wiring; locally, mirror rs-round-trip.spec.ts's manual-start pattern):
 *   - The auth-server and admin console running.
 *   - `pnpm --filter @sassy-auth/auth-server seed` run with SEED_E2E_OIDC=1,
 *     which provisions the "E2E OIDC Client" confidential app
 *     (apps/auth-server/src/seed/e2e-oidc-client.ts) and its scoped user.
 *   - E2E_OIDC_CLIENT_ID set to that app's publicId (playwright.config.ts
 *     reads it from /tmp/sassy-e2e-oidc-client-id.txt, written by
 *     packages/db/scripts/print-app-public-id.cjs — same convention as
 *     RS_CLIENT_ID).
 *   - `node fixtures/oidc-test-client/server.mjs` running on :3002 — the
 *     redirect_uri / post_logout_redirect_uri landing pages.
 */
import { test, expect } from '@playwright/test';
import * as client from 'openid-client';
import { loginAsSeedAdmin } from '../lib/admins';

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010';

test('a stock openid-client completes the full OIDC round trip', async ({ page, request }) => {
  // Discovery — no hand-written endpoint URLs anywhere in this test.
  // `allowInsecureRequests` is openid-client's own documented switch for
  // exercising a server over plain HTTP in local/CI testing (see its
  // TSDoc); it is not a SassyAuth-specific accommodation — any spec-
  // compliant OP tested over http://localhost needs the same opt-in,
  // since the library defaults to refusing non-HTTPS discovery/token
  // requests as a production safety rail.
  const config = await client.discovery(new URL(AUTH_SERVER), process.env.E2E_OIDC_CLIENT_ID!, {
    client_secret: process.env.E2E_OIDC_CLIENT_SECRET!,
  }, undefined, { execute: [client.allowInsecureRequests] });

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const nonce = client.randomNonce();
  const redirectUri = 'http://localhost:3002/callback';

  const authUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    nonce,
  });

  await loginAsSeedAdmin(page);
  await page.goto(authUrl.href);
  await page.waitForURL(/\/callback\?/);

  // Exchange — openid-client validates iss, aud, exp, nonce, and at_hash itself.
  const tokens = await client.authorizationCodeGrant(
    config,
    new URL(page.url()),
    { pkceCodeVerifier: codeVerifier, expectedNonce: nonce },
  );

  expect(tokens.id_token).toBeTruthy();
  const claims = tokens.claims()!;
  expect(claims.sub).toBeTruthy();
  expect(claims.aud).toBe(process.env.E2E_OIDC_CLIENT_ID);
  expect(claims.org).toBeTruthy();

  const userinfo = await client.fetchUserInfo(config, tokens.access_token, claims.sub);
  expect(userinfo.sub).toBe(claims.sub);
  expect(userinfo.email).toBeTruthy();
  expect(userinfo.name).toBeTruthy();

  // The access token carries granted scopes and audience-filtered permissions.
  const decoded = JSON.parse(
    Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString('utf-8'),
  );
  expect(decoded.scope).toBe('openid profile email');
  expect(Array.isArray(decoded.permissions)).toBe(true);

  // Logout.
  const logoutUrl = client.buildEndSessionUrl(config, {
    id_token_hint: tokens.id_token!,
    post_logout_redirect_uri: 'http://localhost:3002/bye',
  });
  const logoutResponse = await request.get(logoutUrl.href, { maxRedirects: 0 });
  expect(logoutResponse.headers()['location']).toContain('http://localhost:3002/bye');
});
