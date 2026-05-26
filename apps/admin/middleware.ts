import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/accept-invite']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || pathname.startsWith('/_next')

  const response = NextResponse.next()

  if (!isPublic) {
    const sessionToken = request.cookies.get('better-auth.session_token')?.value
    if (!sessionToken) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      if (pathname !== '/') url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
