describe('AUTH_SERVER_URL', () => {
  const originalEnv = process.env.AUTH_SERVER_URL

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.AUTH_SERVER_URL
    else process.env.AUTH_SERVER_URL = originalEnv
    jest.resetModules()
  })

  it('falls back to http://localhost:3000 when the env var is unset', async () => {
    delete process.env.AUTH_SERVER_URL
    jest.resetModules()

    const { AUTH_SERVER_URL } = await import('../config')

    expect(AUTH_SERVER_URL).toBe('http://localhost:3000')
  })

  it('uses the env var when set', async () => {
    process.env.AUTH_SERVER_URL = 'https://auth.example.com'
    jest.resetModules()

    const { AUTH_SERVER_URL } = await import('../config')

    expect(AUTH_SERVER_URL).toBe('https://auth.example.com')
  })
})
