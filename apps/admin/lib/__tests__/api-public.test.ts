import { jest } from '@jest/globals'

function jsonResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

let validateInvitation: any, acceptInvitation: any

beforeEach(async () => {
  jest.resetAllMocks()
  jest.resetModules()
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
  const mod = await import('../api-public')
  validateInvitation = mod.validateInvitation
  acceptInvitation = mod.acceptInvitation
})

describe('validateInvitation', () => {
  it('percent-encodes a token containing a slash so the request cannot traverse to a different endpoint', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockResolvedValue(jsonResponse(200, { email: 'a@example.com' }))

    await validateInvitation('abc/../accept')

    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toBe('http://localhost:3000/api/invitations/abc%2F..%2Faccept')
  })
})

describe('acceptInvitation', () => {
  it('percent-encodes a token containing a slash so the request cannot traverse to a different endpoint', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockResolvedValue(jsonResponse(200))

    await acceptInvitation('abc/../accept', 'pw')

    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toBe('http://localhost:3000/api/invitations/abc%2F..%2Faccept/accept')
  })
})
