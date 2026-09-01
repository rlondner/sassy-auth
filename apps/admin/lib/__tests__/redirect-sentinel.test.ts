import { isRedirectSentinel } from '../redirect-sentinel'

describe('isRedirectSentinel', () => {
  it('recognises a NEXT_REDIRECT digest', () => {
    expect(isRedirectSentinel({ digest: 'NEXT_REDIRECT;push;/login;307;' })).toBe(true)
  })

  it('recognises a NEXT_NOT_FOUND digest', () => {
    expect(isRedirectSentinel({ digest: 'NEXT_NOT_FOUND' })).toBe(true)
  })

  it('rejects an unrelated error', () => {
    expect(isRedirectSentinel(new Error('boom'))).toBe(false)
  })

  it('rejects null', () => {
    expect(isRedirectSentinel(null)).toBe(false)
  })

  it('rejects a non-string digest', () => {
    expect(isRedirectSentinel({ digest: 42 })).toBe(false)
  })
})
