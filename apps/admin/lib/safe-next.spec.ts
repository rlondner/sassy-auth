import { validateNextUrl } from './safe-next'

describe('validateNextUrl', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      AUTH_SERVER_URL: 'http://localhost:3000',
      LOGIN_NEXT_ALLOWED_ORIGINS: '',
    }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('returns null for empty/missing input', () => {
    expect(validateNextUrl(null)).toBeNull()
    expect(validateNextUrl(undefined)).toBeNull()
    expect(validateNextUrl('')).toBeNull()
  })

  it('accepts same-origin paths', () => {
    expect(validateNextUrl('/users')).toBe('/users')
    expect(validateNextUrl('/orgs/abc')).toBe('/orgs/abc')
  })

  it('rejects protocol-relative URLs disguised as paths', () => {
    expect(validateNextUrl('//evil.example.com/x')).toBeNull()
  })

  it('rejects backslash-disguised paths', () => {
    expect(validateNextUrl('/\\evil.example.com')).toBeNull()
  })

  it('accepts absolute URLs with allowed origin', () => {
    const url = 'http://localhost:3000/api/token/oauth/authorize?client_id=x'
    expect(validateNextUrl(url)).toBe(url)
  })

  it('rejects absolute URLs with disallowed origin', () => {
    expect(validateNextUrl('https://evil.example.com/auth')).toBeNull()
  })

  it('rejects userinfo URLs', () => {
    expect(
      validateNextUrl('http://attacker@localhost:3000/api/token/oauth/authorize'),
    ).toBeNull()
  })

  it('rejects malformed URLs', () => {
    expect(validateNextUrl('http://[not a url')).toBeNull()
  })

  it('honors LOGIN_NEXT_ALLOWED_ORIGINS env additions', () => {
    process.env.LOGIN_NEXT_ALLOWED_ORIGINS = 'https://other.example.com'
    expect(validateNextUrl('https://other.example.com/cb')).toBe(
      'https://other.example.com/cb',
    )
  })
})
