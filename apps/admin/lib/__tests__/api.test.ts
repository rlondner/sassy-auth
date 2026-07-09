import { jest } from '@jest/globals'
import { cookies } from 'next/headers'

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}))

const mockCookies = cookies as jest.MockedFunction<any>

beforeEach(() => {
  jest.resetAllMocks()
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
  mockCookies.mockResolvedValue({
    toString: () => 'better-auth.session_token=test-token',
  })
})

let getUsers: any, createUser: any, getEffectivePermissions: any

beforeEach(async () => {
  jest.resetModules()
  const mod = await import('../api')
  getUsers = mod.getUsers
  createUser = mod.createUser
  getEffectivePermissions = mod.getEffectivePermissions
})

describe('getUsers', () => {
  it('calls GET /api/users and returns array', async () => {
    const mockUsers = [{ id: '1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', status: 'active', orgId: 'org1', phoneNumber: null, username: null }]
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => mockUsers })
    const result = await getUsers()
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/users'),
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'better-auth.session_token=test-token' })
      })
    )
    expect(result).toEqual(mockUsers)
  })

  it('throws on non-ok response', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 })
    await expect(getUsers()).rejects.toThrow('API error 500')
  })
})

describe('getEffectivePermissions', () => {
  it('unwraps server { userId, permissions: string[] } into Permission[]', async () => {
    // The server returns the union of role-derived + direct permissions as a
    // sorted string[] wrapped in { userId, permissions }. The drawer expects
    // Permission[] with id/name/appId. Verify the API client adapts.
    const serverResponse = {
      userId: 'usr_123',
      permissions: ['platform.apps.manage', 'platform.users.manage'],
    }
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => serverResponse })
    const result = await getEffectivePermissions('usr_123')
    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual([
      { id: 'platform.apps.manage', name: 'platform.apps.manage', appId: '' },
      { id: 'platform.users.manage', name: 'platform.users.manage', appId: '' },
    ])
  })
})

describe('createUser', () => {
  it('POSTs to /api/users with payload', async () => {
    const payload = { firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com', orgId: 'org1' }
    const mockResponse = { user: { ...payload, id: '2', status: 'pending', phoneNumber: null, username: null }, inviteUrl: 'http://localhost:3001/accept-invite?token=abc' }
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => mockResponse })
    const result = await createUser(payload)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/users'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(result.inviteUrl).toBe(mockResponse.inviteUrl)
  })
})
