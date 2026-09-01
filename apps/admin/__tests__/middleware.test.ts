/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

// The module-level session cache in middleware.ts is instance-local, so each
// test re-imports the module to start from an empty cache.
async function loadMiddleware() {
  jest.resetModules()
  return (await import('../middleware')).middleware
}

function requestWithToken(token: string, path = '/users') {
  return new NextRequest(`http://admin.test${path}`, {
    headers: { cookie: `better-auth.session_token=${token}` },
  })
}

function requestWithoutCookie(path: string) {
  return new NextRequest(`http://admin.test${path}`)
}

const CACHE_CONTROL = 'no-store, no-cache, must-revalidate, private'

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('admin middleware session cache', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('serves a valid session from cache on the second request', async () => {
    const middleware = await loadMiddleware()
    fetchMock.mockResolvedValue(jsonResponse(200, { user: { id: 'u1' } }))

    const first = await middleware(requestWithToken('good'))
    const second = await middleware(requestWithToken('good'))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // An authoritative rejection is exactly what the TTL cache is for: the
  // auth-server has answered the question and the answer will not change
  // within 10s.
  it('caches a 401 rejection so a bad token does not hammer the auth-server', async () => {
    const middleware = await loadMiddleware()
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }))

    const first = await middleware(requestWithToken('revoked'))
    const second = await middleware(requestWithToken('revoked'))

    expect(first.headers.get('location')).toContain('/login')
    expect(second.headers.get('location')).toContain('/login')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // A 5xx means the auth-server did NOT answer the question. Caching it as a
  // negative pins the user to /login for the full TTL even after the
  // auth-server recovers — the same lockout the catch block below the fetch
  // explicitly refuses to create for transport errors.
  it.each([500, 502, 503, 504])(
    'does not cache a %d as a negative session result',
    async (status) => {
      const middleware = await loadMiddleware()
      fetchMock.mockResolvedValueOnce(jsonResponse(status))
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }))

      const first = await middleware(requestWithToken('valid-during-outage'))
      const second = await middleware(requestWithToken('valid-during-outage'))

      // Fail closed for the request that hit the outage...
      expect(first.headers.get('location')).toContain('/login')
      // ...but re-probe once the auth-server is back, rather than serving a
      // stale negative from cache.
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(second.status).toBe(200)
    },
  )

  // Rate limiting is transient for the same reason a 503 is.
  it('does not cache a 429 as a negative session result', async () => {
    const middleware = await loadMiddleware()
    fetchMock.mockResolvedValueOnce(jsonResponse(429))
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }))

    const first = await middleware(requestWithToken('rate-limited'))
    const second = await middleware(requestWithToken('rate-limited'))

    expect(first.headers.get('location')).toContain('/login')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(second.status).toBe(200)
  })

  it('does not cache a transport error as a negative session result', async () => {
    const middleware = await loadMiddleware()
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }))

    const first = await middleware(requestWithToken('blipped'))
    const second = await middleware(requestWithToken('blipped'))

    expect(first.headers.get('location')).toContain('/login')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(second.status).toBe(200)
  })
})

describe('admin middleware routing', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it.each(['/login', '/accept-invite', '/oauth-error', '/forgot-password', '/reset-password'])(
    'lets %s through without validating a session',
    async (path) => {
      const middleware = await loadMiddleware()

      const res = await middleware(requestWithoutCookie(path))

      expect(res.status).toBe(200)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  // Genuine children of a public prefix are part of the same public flow and
  // must stay public.
  it.each(['/login/two-factor', '/login/two-factor-prompt', '/login/code'])(
    'lets the public child route %s through',
    async (path) => {
      const middleware = await loadMiddleware()

      const res = await middleware(requestWithoutCookie(path))

      expect(res.status).toBe(200)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  // A path that merely shares a prefix is a different route. Treating it as
  // public skips both session validation and the Cache-Control header, so a
  // future route named this way would silently become unauthenticated.
  it.each(['/loginaudit', '/login-audit', '/reset-passwords', '/oauth-errors'])(
    'requires a session for %s, which only shares a prefix with a public path',
    async (path) => {
      const middleware = await loadMiddleware()

      const res = await middleware(requestWithoutCookie(path))

      expect(res.headers.get('location')).toContain('/login')
    },
  )

  it('lets _next assets through without validating a session', async () => {
    const middleware = await loadMiddleware()

    const res = await middleware(requestWithoutCookie('/_next/static/chunk.js'))

    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('redirects to /login when no session cookie is present at all', async () => {
    const middleware = await loadMiddleware()

    const res = await middleware(requestWithoutCookie('/users'))

    expect(res.headers.get('location')).toContain('/login')
    // No token means no question to ask the auth server.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves the attempted path as the next query parameter', async () => {
    const middleware = await loadMiddleware()
    fetchMock.mockResolvedValue(jsonResponse(401))

    const res = await middleware(requestWithToken('bad', '/orgs'))

    const location = new URL(res.headers.get('location') as string)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe('/orgs')
  })

  it('omits the next parameter when the attempted path is the root', async () => {
    const middleware = await loadMiddleware()
    fetchMock.mockResolvedValue(jsonResponse(401))

    const res = await middleware(requestWithToken('bad', '/'))

    const location = new URL(res.headers.get('location') as string)
    expect(location.searchParams.has('next')).toBe(false)
  })
})

describe('admin middleware cache headers', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  // Authenticated admin pages carry tenant data, so no shared cache or bfcache
  // may retain them after sign-out.
  it('sets no-store on an authenticated response', async () => {
    const middleware = await loadMiddleware()
    fetchMock.mockResolvedValue(jsonResponse(200, { user: { id: 'u1' } }))

    const res = await middleware(requestWithToken('good'))

    expect(res.headers.get('cache-control')).toBe(CACHE_CONTROL)
  })

  it('does not set the header on a public page', async () => {
    const middleware = await loadMiddleware()

    const res = await middleware(requestWithoutCookie('/login'))

    expect(res.headers.get('cache-control')).not.toBe(CACHE_CONTROL)
  })
})

describe('admin middleware session cache lifecycle', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('re-probes the auth-server once the 10s TTL has elapsed', async () => {
    const middleware = await loadMiddleware()
    fetchMock.mockImplementation(() => jsonResponse(200, { user: { id: 'u1' } }))

    await middleware(requestWithToken('good'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Still inside the window: served from cache.
    jest.advanceTimersByTime(9_000)
    await middleware(requestWithToken('good'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Past it: the entry is stale and must be revalidated.
    jest.advanceTimersByTime(1_500)
    await middleware(requestWithToken('good'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keys entries per token so one user cannot answer for another', async () => {
    const middleware = await loadMiddleware()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: 'u1' } }))
      .mockResolvedValueOnce(jsonResponse(401))

    const allowed = await middleware(requestWithToken('alice'))
    const denied = await middleware(requestWithToken('mallory'))

    expect(allowed.status).toBe(200)
    expect(denied.headers.get('location')).toContain('/login')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // The Map is unbounded without this: a burst of distinct tokens would grow
  // it until the instance is recycled.
  it('stays bounded when flooded with more distinct tokens than the cap', async () => {
    const middleware = await loadMiddleware()
    // A fresh Response per call: a body may only be read once, so reusing one
    // object would make every request after the first throw in res.json().
    fetchMock.mockImplementation(() => jsonResponse(200, { user: { id: 'u1' } }))

    // 600 distinct live tokens against a 500-entry cap, with no time passing,
    // so the expiry sweep cannot free anything and the overflow drop must.
    for (let i = 0; i < 600; i++) {
      await middleware(requestWithToken(`tok-${i}`))
    }

    // Every request was a miss, so the map never exceeded the cap by more than
    // the single entry being added.
    expect(fetchMock).toHaveBeenCalledTimes(600)

    // A token evicted by the overflow drop is re-probed rather than served
    // from a stale entry.
    const callsBefore = fetchMock.mock.calls.length
    await middleware(requestWithToken('tok-0'))
    expect(fetchMock).toHaveBeenCalledTimes(callsBefore + 1)
  })

  it('sweeps expired entries rather than dropping live ones when the cap is reached', async () => {
    const middleware = await loadMiddleware()
    fetchMock.mockImplementation(() => jsonResponse(200, { user: { id: 'u1' } }))

    // Fill with entries that will all be expired by the time the cap is hit.
    for (let i = 0; i < 499; i++) {
      await middleware(requestWithToken(`old-${i}`))
    }
    jest.advanceTimersByTime(11_000)

    // This request trips the cap check, whose expiry sweep should clear the
    // 499 stale entries.
    await middleware(requestWithToken('fresh'))
    const callsAfterFill = fetchMock.mock.calls.length

    // `fresh` is still live, so it must come from cache, proving the sweep
    // removed the expired entries and not the new one.
    await middleware(requestWithToken('fresh'))
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFill)
  })
})
