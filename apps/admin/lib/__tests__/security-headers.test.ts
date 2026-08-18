import { buildSecurityHeaders } from '../security-headers'

function find(headers: Array<{ key: string; value: string }>, key: string) {
  return headers.find((h) => h.key.toLowerCase() === key.toLowerCase())
}

describe('buildSecurityHeaders', () => {
  it('keeps the bug-0191 baseline headers in every environment', () => {
    for (const env of ['development', 'test', 'production']) {
      const headers = buildSecurityHeaders(env)
      expect(find(headers, 'X-Frame-Options')?.value).toBe('DENY')
      expect(find(headers, 'X-Content-Type-Options')?.value).toBe('nosniff')
      expect(find(headers, 'Referrer-Policy')?.value).toBe('strict-origin-when-cross-origin')
      expect(find(headers, 'Permissions-Policy')?.value).toContain('camera=()')
    }
  })

  // bug-0223: without HSTS a user typing http://admin.example.com is not
  // upgraded, so the first request — which can carry a session cookie —
  // travels in the clear. That is the SSL-stripping window.
  it('sends HSTS in production', () => {
    const hsts = find(buildSecurityHeaders('production'), 'Strict-Transport-Security')
    expect(hsts).toBeDefined()
    expect(hsts?.value).toContain('max-age=63072000')
    expect(hsts?.value).toContain('includeSubDomains')
  })

  // Browsers honour HSTS on localhost too. Emitting it in dev would pin
  // http://localhost:3001 to HTTPS in the developer's browser — and every
  // other localhost project with it — recoverable only via
  // chrome://net-internals/#hsts.
  it.each(['development', 'test'])('does not send HSTS in %s', (env) => {
    expect(find(buildSecurityHeaders(env), 'Strict-Transport-Security')).toBeUndefined()
  })

  it('treats an unset NODE_ENV as non-production', () => {
    expect(find(buildSecurityHeaders(undefined), 'Strict-Transport-Security')).toBeUndefined()
  })

  // `preload` is a one-way door: getting off the browsers' preload list needs
  // a vendor delisting process that takes months. Opt in deliberately, not by
  // inheriting it from a snippet.
  it('does not opt into the browser preload list', () => {
    const hsts = find(buildSecurityHeaders('production'), 'Strict-Transport-Security')
    expect(hsts?.value).not.toContain('preload')
  })
})
