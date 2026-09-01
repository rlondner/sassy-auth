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

let getForwardedOrigin: any

beforeEach(async () => {
  jest.resetAllMocks()
  jest.resetModules()
  const mod = await import('../auth-origin')
  getForwardedOrigin = mod.getForwardedOrigin
})

describe('getForwardedOrigin', () => {
  it('returns the origin from an Origin header', async () => {
    mockHeaders.mockResolvedValue(headersReturning({ origin: 'https://admin.example.com' }))

    const result = await getForwardedOrigin()

    expect(result).toBe('https://admin.example.com')
  })

  it('falls back to the Referer header when Origin is absent', async () => {
    mockHeaders.mockResolvedValue(
      headersReturning({ referer: 'https://admin.example.com/login?next=/users' }),
    )

    const result = await getForwardedOrigin()

    expect(result).toBe('https://admin.example.com')
  })

  it('returns only the origin component, never the full referer path', async () => {
    mockHeaders.mockResolvedValue(
      headersReturning({ referer: 'https://admin.example.com/some/deep/path?x=1' }),
    )

    const result = await getForwardedOrigin()

    expect(result).toBe('https://admin.example.com')
    expect(result).not.toContain('/some/deep/path')
  })

  it('returns null when neither Origin nor Referer is present', async () => {
    mockHeaders.mockResolvedValue(headersReturning({}))

    const result = await getForwardedOrigin()

    expect(result).toBeNull()
  })

  it('returns null when the header value is not a parseable URL', async () => {
    mockHeaders.mockResolvedValue(headersReturning({ origin: 'not-a-url' }))

    const result = await getForwardedOrigin()

    expect(result).toBeNull()
  })
})
