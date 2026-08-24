/**
 * Covers the apps, orgs, roles and permissions server actions: status-to-key
 * error mapping, revalidation, and how each catch-all treats Next's redirect
 * sentinel.
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/api', () => ({
  createApp: jest.fn(), updateApp: jest.fn(), deleteApp: jest.fn(), getApps: jest.fn(),
  getSocialProviderSettings: jest.fn(), setSocialProviders: jest.fn(),
  createOrg: jest.fn(), updateOrg: jest.fn(), deleteOrg: jest.fn(), getOrgs: jest.fn(),
  createRole: jest.fn(), updateRole: jest.fn(), deleteRole: jest.fn(), getRoles: jest.fn(),
  getRole: jest.fn(),
  createPermission: jest.fn(), updatePermission: jest.fn(), deletePermission: jest.fn(),
  getPermissions: jest.fn(), getPermission: jest.fn(),
  createUser: jest.fn(), updateUser: jest.fn(), deleteUser: jest.fn(), getUsers: jest.fn(),
  getUser: jest.fn(), getUserRoles: jest.fn(), getEffectivePermissions: jest.fn(),
  assignRole: jest.fn(), removeRole: jest.fn(), resendInvitation: jest.fn(),
  resetPassword: jest.fn(), setUserRoles: jest.fn(),
  getUserDirectPermissions: jest.fn(), setUserDirectPermissions: jest.fn(),
}))

// Re-resolved in beforeEach: jest.resetModules() hands the dynamically
// imported action modules a fresh copy of the mock registry, so references
// captured at file scope would point at stale jest.fn()s.
let mockedApi: any
let mockRevalidate: jest.MockedFunction<any>

/** What next/navigation's redirect() throws: an Error carrying a digest. */
function redirectSentinel() {
  const err = new Error('NEXT_REDIRECT') as Error & { digest: string }
  err.digest = 'NEXT_REDIRECT;push;/login;307;'
  return err
}

let appsActions: any, orgsActions: any, rolesActions: any, permsActions: any

beforeEach(async () => {
  jest.clearAllMocks()
  jest.resetModules()
  mockedApi = await import('@/lib/api')
  mockRevalidate = (await import('next/cache'))
    .revalidatePath as jest.MockedFunction<any>
  appsActions = await import('../apps/actions')
  orgsActions = await import('../orgs/actions')
  rolesActions = await import('../roles/actions')
  permsActions = await import('../permissions/actions')
})

describe('apps actions', () => {
  it('returns the created app and revalidates on success', async () => {
    mockedApi.createApp.mockResolvedValue({ publicId: 'a1' } as never)

    const result = await appsActions.createAppAction({ name: 'A' })

    expect(result).toEqual({ app: { publicId: 'a1' } })
    expect(mockRevalidate).toHaveBeenCalledWith('/apps')
  })

  it.each([
    ['API error 409: name taken', 'apps.errors.nameExists'],
    ['API error 403: platform app', 'apps.errors.platformProtected'],
    ['API error 400: url insecure', 'apps.errors.urlInsecure'],
    ['API error 500: boom', 'apps.errors.generic'],
  ])('maps %s to %s on create', async (message, key) => {
    mockedApi.createApp.mockRejectedValue(new Error(message))

    expect(await appsActions.createAppAction({ name: 'A' })).toEqual({
      errorKey: key,
    })
  })

  it('maps a 409 on delete to the dependents key rather than name-exists', async () => {
    mockedApi.deleteApp.mockRejectedValue(new Error('API error 409: in use'))

    expect(await appsActions.deleteAppAction('a1')).toEqual({
      errorKey: 'apps.errors.hasDependents',
    })
  })

  it('does not revalidate when the call fails', async () => {
    mockedApi.updateApp.mockRejectedValue(new Error('API error 500'))

    await appsActions.updateAppAction('a1', { name: 'B' })

    expect(mockRevalidate).not.toHaveBeenCalled()
  })
})

describe('orgs actions', () => {
  it('returns the created org and revalidates on success', async () => {
    mockedApi.createOrg.mockResolvedValue({ publicId: 'o1' } as never)

    const result = await orgsActions.createOrgAction({ name: 'O' })

    expect(result).toEqual({ org: { publicId: 'o1' } })
    expect(mockRevalidate).toHaveBeenCalledWith('/orgs')
  })

  it('maps an unexpected failure to a generic key', async () => {
    mockedApi.deleteOrg.mockRejectedValue(new Error('API error 500: boom'))

    const result = await orgsActions.deleteOrgAction('o1')

    expect(result).toHaveProperty('errorKey')
  })
})

describe('roles actions', () => {
  it('returns the created role and revalidates on success', async () => {
    mockedApi.createRole.mockResolvedValue({ publicId: 'r1' } as never)

    const result = await rolesActions.createRoleAction({ name: 'R' })

    expect(result).toEqual({ role: { publicId: 'r1' } })
    expect(mockRevalidate).toHaveBeenCalledWith('/roles')
  })

  it('maps an unexpected failure to a generic key', async () => {
    mockedApi.deleteRole.mockRejectedValue(new Error('API error 500: boom'))

    expect(await rolesActions.deleteRoleAction('r1')).toHaveProperty('errorKey')
  })
})

describe('permissions actions', () => {
  it('returns the created permission and revalidates on success', async () => {
    mockedApi.createPermission.mockResolvedValue({ publicId: 'p1' } as never)

    const result = await permsActions.createPermissionAction({ name: 'p.read' })

    expect(result).toEqual({ permission: { publicId: 'p1' } })
    expect(mockRevalidate).toHaveBeenCalledWith('/permissions')
  })

  it('maps an unexpected failure to a generic key', async () => {
    mockedApi.deletePermission.mockRejectedValue(new Error('API error 500'))

    expect(await permsActions.deletePermissionAction('p1')).toHaveProperty(
      'errorKey',
    )
  })
})

// apiFetch calls redirect('/login') on a 401, which throws a sentinel Error
// that Next's own machinery watches for. Any catch-all that swallows it
// silently cancels the navigation and strands the user on a dead page, so
// every one of these must let it through.
describe('the redirect sentinel propagates through every catch-all', () => {
  it.each([
    ['createAppAction', () => appsActions.createAppAction, 'createApp', [{ name: 'A' }]],
    ['updateAppAction', () => appsActions.updateAppAction, 'updateApp', ['a1', {}]],
    ['deleteAppAction', () => appsActions.deleteAppAction, 'deleteApp', ['a1']],
    ['createOrgAction', () => orgsActions.createOrgAction, 'createOrg', [{ name: 'O' }]],
    ['deleteOrgAction', () => orgsActions.deleteOrgAction, 'deleteOrg', ['o1']],
    ['createRoleAction', () => rolesActions.createRoleAction, 'createRole', [{ name: 'R' }]],
    ['deleteRoleAction', () => rolesActions.deleteRoleAction, 'deleteRole', ['r1']],
    [
      'createPermissionAction',
      () => permsActions.createPermissionAction,
      'createPermission',
      [{ name: 'p.read' }],
    ],
    [
      'deletePermissionAction',
      () => permsActions.deletePermissionAction,
      'deletePermission',
      ['p1'],
    ],
  ])('%s rethrows it', async (_name, getFn, apiName, args) => {
    ;(mockedApi as any)[apiName].mockRejectedValue(redirectSentinel())

    await expect(getFn()(...(args as unknown[]))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    })
  })

  // users/actions.ts already had the guard; it is the reference the four
  // modules above were brought in line with.
  it('users actions rethrow it, as they already did', async () => {
    const usersActions = await import('../users/actions')
    mockedApi.createUser.mockRejectedValue(redirectSentinel())

    await expect(
      usersActions.createUserAction({ email: 'a@b.io' } as never),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
  })
})
