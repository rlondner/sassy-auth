import { clientIdFromNext } from '../client-id-from-next'

describe('clientIdFromNext', () => {
  it('extracts client_id from an absolute authorize URL', () => {
    expect(clientIdFromNext('https://auth.test/api/token/oauth/authorize?client_id=sq_1&redirect_uri=x')).toBe('sq_1')
  })

  it('extracts client_id from a relative next', () => {
    expect(clientIdFromNext('/api/token/oauth/authorize?client_id=sq_1')).toBe('sq_1')
  })

  it('returns null for an empty next', () => {
    expect(clientIdFromNext('')).toBeNull()
  })

  it('returns null when next has no client_id', () => {
    expect(clientIdFromNext('/users')).toBeNull()
  })

  it('returns null for an unparseable next', () => {
    expect(clientIdFromNext('::::not a url')).toBeNull()
  })
})
