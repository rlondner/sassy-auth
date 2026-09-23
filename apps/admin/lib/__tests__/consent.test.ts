import { extractClientId } from '../consent'

describe('extractClientId', () => {
  it('extracts client_id from a relative next URL', () => {
    expect(extractClientId('/authorize?client_id=sq_1&redirect_uri=https://x.example.com')).toBe('sq_1')
  })

  it('extracts client_id from an absolute next URL', () => {
    expect(extractClientId('https://auth.example.com/authorize?client_id=sq_1')).toBe('sq_1')
  })

  it('returns null when next has no client_id', () => {
    expect(extractClientId('/users')).toBeNull()
  })

  it('returns null for an empty/null next', () => {
    expect(extractClientId('')).toBeNull()
    expect(extractClientId(null)).toBeNull()
  })
})
