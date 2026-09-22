import { headers } from 'next/headers'

jest.mock('next/headers', () => ({
  headers: jest.fn(),
}))

const mockHeaders = headers as jest.MockedFunction<any>

function headersReturning(map: Record<string, string>) {
  return {
    get: (name: string) => map[name] ?? null,
  }
}

let getForwardedClientIpHeader: any

beforeEach(async () => {
  jest.resetAllMocks()
  jest.resetModules()
  const mod = await import('../forward-client-ip')
  getForwardedClientIpHeader = mod.getForwardedClientIpHeader
})

describe('getForwardedClientIpHeader', () => {
  it('returns an X-Forwarded-For header when the incoming request has one', async () => {
    mockHeaders.mockResolvedValue(headersReturning({ 'x-forwarded-for': '203.0.113.7' }))

    const result = await getForwardedClientIpHeader()

    expect(result).toEqual({ 'X-Forwarded-For': '203.0.113.7' })
  })

  it('forwards the full chain verbatim when the incoming header has multiple entries', async () => {
    mockHeaders.mockResolvedValue(headersReturning({ 'x-forwarded-for': '203.0.113.7, 198.51.100.9' }))

    const result = await getForwardedClientIpHeader()

    expect(result).toEqual({ 'X-Forwarded-For': '203.0.113.7, 198.51.100.9' })
  })

  it('returns an empty object when no x-forwarded-for header is present (direct/local connection)', async () => {
    mockHeaders.mockResolvedValue(headersReturning({}))

    const result = await getForwardedClientIpHeader()

    expect(result).toEqual({})
  })
})
