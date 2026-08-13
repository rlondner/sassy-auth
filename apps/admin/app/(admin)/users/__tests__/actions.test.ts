/**
 * bug-0234: user actions must not hand raw NestJS error text to the UI.
 * Every failure path returns a stable i18n key; the raw message stays
 * server-side.
 */
import { createUserAction, updateUserAction } from '../actions'
import * as api from '@/lib/api'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/api', () => ({
  createUser: jest.fn(),
  updateUser: jest.fn(),
  getUserRoles: jest.fn(),
  getEffectivePermissions: jest.fn(),
  getUserDirectPermissions: jest.fn(),
  setUserRoles: jest.fn(),
  setUserDirectPermissions: jest.fn(),
  getRoles: jest.fn(),
  getPermissions: jest.fn(),
  deleteUser: jest.fn(),
  resetPassword: jest.fn(),
  resendInvitation: jest.fn(),
}))

const mockedApi = api as jest.Mocked<typeof api>

const RAW_LEAK =
  "API error 500: /api/users Cannot read properties of undefined (reading 'orgId') at UsersService.create (/srv/src/users/users.service.ts:212:19)"

beforeEach(() => {
  jest.clearAllMocks()
})

describe('createUserAction', () => {
  it('returns the invite url on success', async () => {
    mockedApi.createUser.mockResolvedValue({ inviteUrl: 'https://admin/accept?token=t' } as never)

    const result = await createUserAction({
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.io',
      orgId: 'org_1',
    } as never)

    expect(result).toEqual({ inviteUrl: 'https://admin/accept?token=t' })
  })

  it('maps a 409 to the duplicate-email key', async () => {
    mockedApi.createUser.mockRejectedValue(new Error('API error 409: email already exists'))

    const result = await createUserAction({ email: 'a@b.io' } as never)

    expect(result).toEqual({ errorKey: 'users.errors.emailExists' })
  })

  it('maps a 403 to the forbidden key', async () => {
    mockedApi.createUser.mockRejectedValue(new Error('API error 403: Forbidden resource'))

    const result = await createUserAction({ email: 'a@b.io' } as never)

    expect(result).toEqual({ errorKey: 'users.errors.forbidden' })
  })

  it('maps a 400 to the validation key', async () => {
    mockedApi.createUser.mockRejectedValue(
      new Error('API error 400: ["email must be an email","orgId should not be empty"]'),
    )

    const result = await createUserAction({ email: 'nope' } as never)

    expect(result).toEqual({ errorKey: 'users.errors.validation' })
  })

  it('never returns the raw server error text for a 500', async () => {
    mockedApi.createUser.mockRejectedValue(new Error(RAW_LEAK))

    const result = await createUserAction({ email: 'a@b.io' } as never)

    expect(result).toEqual({ errorKey: 'users.errors.generic' })
    expect(JSON.stringify(result)).not.toContain('users.service.ts')
    expect(JSON.stringify(result)).not.toContain('Cannot read properties')
  })

  it('re-throws the NEXT_REDIRECT sentinel so the 401 bounce to /login still happens', async () => {
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    })
    mockedApi.createUser.mockRejectedValue(redirectError)

    await expect(createUserAction({ email: 'a@b.io' } as never)).rejects.toBe(redirectError)
  })
})

describe('updateUserAction', () => {
  it('returns the updated user on success', async () => {
    const user = { id: 'u_1', firstName: 'A' }
    mockedApi.updateUser.mockResolvedValue(user as never)

    const result = await updateUserAction('u_1', { firstName: 'A' })

    expect(result).toEqual({ user })
  })

  it('never returns the raw server error text', async () => {
    mockedApi.updateUser.mockRejectedValue(new Error(RAW_LEAK))

    const result = await updateUserAction('u_1', { firstName: 'A' })

    expect(result).toEqual({ errorKey: 'users.errors.generic' })
    expect(JSON.stringify(result)).not.toContain('users.service.ts')
  })

  it('maps a 403 on self-modification to the self key', async () => {
    mockedApi.updateUser.mockRejectedValue(
      new Error('API error 403: You cannot modify your own account'),
    )

    const result = await updateUserAction('u_1', { status: 'inactive' } as never)

    expect(result).toEqual({ errorKey: 'users.errors.selfModify' })
  })

  it('maps a plain 403 to the forbidden key', async () => {
    mockedApi.updateUser.mockRejectedValue(new Error('API error 403: Forbidden resource'))

    const result = await updateUserAction('u_1', { firstName: 'A' })

    expect(result).toEqual({ errorKey: 'users.errors.forbidden' })
  })

  it('maps a 400 to the validation key', async () => {
    mockedApi.updateUser.mockRejectedValue(new Error('API error 400: username too short'))

    const result = await updateUserAction('u_1', { username: 'x' } as never)

    expect(result).toEqual({ errorKey: 'users.errors.validation' })
  })

  it('re-throws the NEXT_REDIRECT sentinel instead of swallowing it (bug-0221)', async () => {
    const redirectError = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    })
    mockedApi.updateUser.mockRejectedValue(redirectError)

    await expect(updateUserAction('u_1', { firstName: 'A' })).rejects.toBe(redirectError)
  })
})
