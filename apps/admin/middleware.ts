import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/accept-invite', '/oauth-error']
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'
const SESSION_CACHE_MAX_AGE = 60 // seconds — revalidate session at most once per minute

async function validateSession(request: NextRequest): Promise<boolean> {
  const cookieHeader = request.headers.get('cookie') ?? ''
  if (!cookieHeader.includes('better-auth.session_token=')) return false

  // Short-circuit: if we validated recently, skip the round-trip.
  const cacheTs = request.cookies.get('sa-session-ok')?.value
  if (cacheTs) {
    const age = Math.floor(Date.now() / 1000) - Number(cacheTs)
    if (age >= 0 && age < SESSION_CACHE_MAX_AGE) return true
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${AUTH_SERVER}/api/auth/get-session`, {
      headers: { Cookie: cookieHeader },
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return false
    const body = (await res.json()) as { user?: unknown } | null
    return Boolean(body?.user)
  } catch {
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
    const response = NextResponse.redirect(url)
    // Clear the cache cookie on auth failure so stale cache doesn't loop.
    response.cookies.delete('sa-session-ok')
    return response
  }

  // Stamp a short-lived cache cookie so subsequent requests in this
  // browser window skip the auth-server round-trip.
  const response = NextResponse.next()
  response.cookies.set('sa-session-ok', String(Math.floor(Date.now() / 1000)), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_CACHE_MAX_AGE,
  })
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
