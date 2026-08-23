// Minimal OIDC provider for e2e. Signs RS256 id_tokens with a keypair
// generated at startup (never a committed key), and lets each test choose
// the identity it returns.
//
// IDENTITY SELECTION — read this before wiring a spec to this fixture:
//
// BetterAuth's genericOAuth plugin builds the /authorize URL itself
// (better-auth/dist/plugins/generic-oauth/routes.mjs, signInWithOAuth2):
// it calls createAuthorizationURL with exactly { clientId, redirectURI,
// state, codeVerifier, scopes, prompt, accessType, responseType,
// responseMode, additionalParams }. `additionalParams` comes from the
// PROVIDER CONFIG (a static value or a function of the server-side auth
// context — see stubProviderConfig), never from the browser's sign-in
// request. There is no field on POST /sign-in/oauth2's body schema that
// reaches the query string of the /authorize redirect. So a test cannot
// get the browser to hit `/authorize?sub=...&email=...` — the "obvious"
// per-request query-parameter approach described in the task-11 brief does
// NOT survive BetterAuth's redirect chain; those query params are simply
// never populated by anything the browser does.
//
// What DOES survive: a side channel. Playwright test code runs in Node, not
// the browser, so before clicking "Sign in with stub" a test can call this
// server directly — e.g.
//   await request.post('http://localhost:9099/__set-identity', {
//     data: { sub: 'stub-sub-2', email: 'unverified@cpm.io', email_verified: false },
//   })
// which stores the identity in memory. /authorize then serves THAT identity
// (query params remain a secondary, curl-friendly override for the
// standalone manual verification in task-11-report.md, but nothing in the
// real BetterAuth flow ever sets them). The suite runs with a single
// Playwright worker (playwright.config.ts: workers: 1) so this shared
// in-memory state does not race between specs.
import { createServer } from 'node:http'
import crypto from 'node:crypto'

const PORT = Number(process.env.STUB_IDP_PORT ?? 9099)
const ISSUER = process.env.STUB_IDP_ISSUER ?? `http://localhost:${PORT}`

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'stub-key', alg: 'RS256', use: 'sig' }

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

function idToken(claims) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'RS256', typ: 'JWT', kid: 'stub-key' })
  const payload = b64({
    iss: ISSUER,
    aud: 'stub-client',
    sub: claims.sub,
    email: claims.email,
    email_verified: claims.email_verified,
    name: claims.name ?? 'Stub User',
    iat: now,
    exp: now + 600,
  })
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  return `${header}.${payload}.${signer.sign(privateKey, 'base64url')}`
}

// The identity /authorize hands out when the caller (BetterAuth's redirect,
// which never carries sub/email/email_verified) doesn't specify one via
// query params. Set by tests through POST /__set-identity before they click
// the sign-in button; reset to this default after every /token redemption
// so one test's choice can't silently leak into the next.
const DEFAULT_IDENTITY = { sub: 'stub-sub-1', email: 'social@cpm.io', email_verified: true }
let nextIdentity = { ...DEFAULT_IDENTITY }

// Authorization codes issued by /authorize, redeemed once by /token.
const codes = new Map()

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER)
  const json = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (url.pathname === '/.well-known/openid-configuration') {
    return json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'email', 'profile'],
    })
  }

  if (url.pathname === '/jwks') return json({ keys: [jwk] })

  // Side channel used by e2e specs: set the identity the NEXT /authorize
  // call (however it's triggered — including through BetterAuth's redirect,
  // which carries no identity params of its own) will hand out.
  if (url.pathname === '/__set-identity' && req.method === 'POST') {
    const body = await readBody(req)
    let parsed = {}
    try {
      parsed = body ? JSON.parse(body) : {}
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }
    nextIdentity = {
      sub: parsed.sub ?? DEFAULT_IDENTITY.sub,
      email: parsed.email ?? DEFAULT_IDENTITY.email,
      email_verified: parsed.email_verified ?? DEFAULT_IDENTITY.email_verified,
      ...(parsed.name ? { name: parsed.name } : {}),
    }
    return json({ ok: true, identity: nextIdentity })
  }

  if (url.pathname === '/__reset-identity' && req.method === 'POST') {
    nextIdentity = { ...DEFAULT_IDENTITY }
    return json({ ok: true, identity: nextIdentity })
  }

  if (url.pathname === '/authorize') {
    // Query params remain a manual/curl-friendly override (see Step 8 of
    // the task-11 brief) but BetterAuth's own redirect into this endpoint
    // never sets them — see the module comment above. Falls back to
    // whatever /__set-identity last configured, then to the hardcoded
    // default.
    const code = crypto.randomBytes(16).toString('hex')
    const sub = url.searchParams.get('sub') ?? nextIdentity.sub
    const email = url.searchParams.get('email') ?? nextIdentity.email
    const emailVerifiedParam = url.searchParams.get('email_verified')
    const email_verified =
      emailVerifiedParam !== null ? emailVerifiedParam !== 'false' : nextIdentity.email_verified
    codes.set(code, { sub, email, email_verified, name: nextIdentity.name })

    const redirectUri = url.searchParams.get('redirect_uri')
    if (!redirectUri) return json({ error: 'invalid_request', error_description: 'redirect_uri required' }, 400)
    const redirect = new URL(redirectUri)
    redirect.searchParams.set('code', code)
    const state = url.searchParams.get('state')
    if (state) redirect.searchParams.set('state', state)
    res.writeHead(302, { location: redirect.toString() })
    return res.end()
  }

  if (url.pathname === '/token' && req.method === 'POST') {
    const body = await readBody(req)
    const code = new URLSearchParams(body).get('code')
    const claims = codes.get(code)
    if (!claims) return json({ error: 'invalid_grant' }, 400)
    codes.delete(code)
    // Consumed — restore the default so the next /authorize (any spec that
    // forgot to call /__set-identity, or a curl smoke test) gets a known,
    // deterministic identity rather than a previous test's leftover choice.
    nextIdentity = { ...DEFAULT_IDENTITY }
    return json({
      access_token: 'stub-access-token',
      token_type: 'Bearer',
      expires_in: 600,
      id_token: idToken(claims),
    })
  }

  return json({ error: 'not_found' }, 404)
}).listen(PORT, () => console.log(`[stub-idp] listening on ${ISSUER}`))
