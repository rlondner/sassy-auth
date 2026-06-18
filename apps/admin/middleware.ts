import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/accept-invite', '/oauth-error']
const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

async function validateSession(request: NextRequest): Promise<boolean> {
  // Forward the inbound cookie header to the auth server so BetterAuth
  // can validate the session against its store. Any non-empty value
  // in the cookie alone does NOT prove authentication.
  const cookieHeader = request.headers.get('cookie') ?? ''
  if (!cookieHeader.includes('better-auth.session_token=')) return false

  try {
    const res = await fetch(`${AUTH_SERVER}/api/auth/get-session`, {
      headers: { Cookie: cookieHeader },
      // Edge runtime — must not cache or be revalidated.
      cache: 'no-store',
    })
    if (!res.ok) return false
    const body = (await res.json()) as { user?: unknown } | null
    return Boolean(body?.user)
  } catch {
    // Fail closed on transport errors — better to bounce to /login than
    // render a shell to an unauthenticated client.
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

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
