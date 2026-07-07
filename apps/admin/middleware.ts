import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/accept-invite', '/oauth-error']
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

// bug-0165: cache session validation results for a short TTL so we
// don't round-trip to the auth-server on every authenticated request.
// Typical admin navigation (a user clicking through a few pages)
// previously incurred one full HTTP round-trip per navigation just
// to say "yes, still signed in." With a 10s TTL cache and a normal
// click cadence, that drops to roughly one round-trip per session
// per Next.js instance.
//
// Trade-off: after a real sign-out, the user's session cookie is
// deleted client-side (so subsequent requests miss the cache
// entirely) and the auth-server marks the Session row invalid. The
// only staleness window is a token that was revoked SERVER-side
// (e.g., another session-management flow invalidated it) while
// still being present on the client — that user would remain
// "authenticated" for up to 10s. The bug-0158 decision to keep
// BetterAuth's own cookieCache OFF means the auth-server itself
// is authoritative on every miss, so this cache lives here in
// the admin gateway.
//
// The Map is instance-local — Next.js Edge / Node runtimes share
// it across requests within one warm invocation, and each replica
// starts empty. That's the correct blast radius: revocation is
// still eventually consistent across the fleet, bounded by the
// TTL below.
const SESSION_CACHE_TTL_MS = 10_000
const SESSION_CACHE_MAX_ENTRIES = 500
const sessionCache = new Map<string, { at: number; ok: boolean }>()

function readSessionToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/(?:^|;\s*)better-auth\.session_token=([^;]+)/)
  return match ? match[1] : null
}

async function validateSession(request: NextRequest): Promise<boolean> {
  // Forward the inbound cookie header to the auth server so BetterAuth
  // can validate the session against its store. Any non-empty value
  // in the cookie alone does NOT prove authentication.
  const cookieHeader = request.headers.get('cookie') ?? ''
  const token = readSessionToken(cookieHeader)
  if (!token) return false

  const now = Date.now()
  const cached = sessionCache.get(token)
  if (cached && now - cached.at < SESSION_CACHE_TTL_MS) {
    return cached.ok
  }

  // Opportunistic eviction: prune expired entries when the cache
  // starts to grow. Cheaper than an LRU on the Edge runtime and
  // good enough because most cookies churn out via expiration
  // anyway.
  if (sessionCache.size >= SESSION_CACHE_MAX_ENTRIES) {
    for (const [k, v] of sessionCache) {
      if (now - v.at >= SESSION_CACHE_TTL_MS) sessionCache.delete(k)
    }
    // If eviction didn't free anything (e.g., a burst of fresh
    // tokens), drop the oldest N to keep the map bounded.
    if (sessionCache.size >= SESSION_CACHE_MAX_ENTRIES) {
      const overflow = sessionCache.size - Math.floor(SESSION_CACHE_MAX_ENTRIES * 0.9)
      let i = 0
      for (const k of sessionCache.keys()) {
        if (i++ >= overflow) break
        sessionCache.delete(k)
      }
    }
  }

  try {
    const res = await fetch(`${AUTH_SERVER}/api/auth/get-session`, {
      headers: { Cookie: cookieHeader },
      // Edge runtime — must not cache or be revalidated.
      cache: 'no-store',
    })
    if (!res.ok) {
      sessionCache.set(token, { at: now, ok: false })
      return false
    }
    const body = (await res.json()) as { user?: unknown } | null
    const ok = Boolean(body?.user)
    sessionCache.set(token, { at: now, ok })
    return ok
  } catch {
    // Fail closed on transport errors — better to bounce to /login than
    // render a shell to an unauthenticated client. Also don't cache the
    // failure — a transient network blip shouldn't lock the user out
    // for TTL seconds.
    return false
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublic =
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next')

  if (isPublic) return NextResponse.next()

  const ok = await validateSession(request)
  if (!ok) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    if (pathname !== '/') url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // bug-0191: authenticated admin pages carry sensitive tenant data
  // (user lists, org configs, permissions). Set Cache-Control on every
  // authenticated response so shared caches never store them and the
  // browser's bfcache doesn't serve them after sign-out. `private`
  // reinforces that any caller cache treating the response as private
  // must still honor no-store. Public pages (login, accept-invite,
  // oauth-error) skip this in the early return above.
  const response = NextResponse.next()
  response.headers.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, private',
  )
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
