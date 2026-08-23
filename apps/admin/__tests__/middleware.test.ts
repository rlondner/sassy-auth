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

function requestWithToken(token: string) {
  return new NextRequest('http://admin.test/users', {
    headers: { cookie: `better-auth.session_token=${token}` },
  })
}

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
