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
  it('returns the parsed invitation info on a 200 response', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    const info = { email: 'a@example.com', orgName: 'Acme' }
    fetchMock.mockResolvedValue(jsonResponse(200, info))

    const result = await validateInvitation('plain-token')

    expect(result).toEqual(info)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/invitations/plain-token')
  })

  it('percent-encodes a token containing a slash so the request cannot traverse to a different endpoint', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockResolvedValue(jsonResponse(200, { email: 'a@example.com' }))

    await validateInvitation('abc/../accept')

    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toBe('http://localhost:3000/api/invitations/abc%2F..%2Faccept')
  })

  it('does not include the token value in the thrown error on a non-ok response', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockResolvedValue(jsonResponse(404))

    const secretToken = 'a-secret-invitation-token'
    let caught: unknown
    try {
      await validateInvitation(secretToken)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).not.toContain(secretToken)
  })
})

describe('acceptInvitation', () => {
  it('POSTs the password as JSON to the expected URL on success', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockResolvedValue(jsonResponse(200))

    await expect(acceptInvitation('plain-token', 'hunter2')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/invitations/plain-token/accept',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'hunter2' }),
      },
    )
  })

  it('percent-encodes a token containing a slash so the request cannot traverse to a different endpoint', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockResolvedValue(jsonResponse(200))

    await acceptInvitation('abc/../accept', 'pw')

    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toBe('http://localhost:3000/api/invitations/abc%2F..%2Faccept/accept')
  })

  it('does not include the token value in the thrown error on a non-ok response', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>
    fetchMock.mockResolvedValue(jsonResponse(400))

    const secretToken = 'a-secret-invitation-token'
    let caught: unknown
    try {
      await acceptInvitation(secretToken, 'pw')
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).not.toContain(secretToken)
  })
})
