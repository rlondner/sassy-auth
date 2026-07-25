import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { UserViewDrawer } from '../user-view-drawer'
import type { User } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params) return `${key}(${JSON.stringify(params)})`
    return key
  },
}))


jest.mock('@/app/(admin)/users/actions', () => ({
  getUserRolesAction: jest.fn().mockResolvedValue([{ publicId: 'r1', name: 'admin', appId: 'app1' }]),
  getEffectivePermissionsAction: jest.fn().mockResolvedValue([{ id: 'p1', name: 'users.read', appId: 'app1' }]),
  getUserDirectPermissionsAction: jest.fn().mockResolvedValue([]),
  setUserRolesAction: jest.fn().mockResolvedValue({ ok: true }),
  setUserDirectPermissionsAction: jest.fn().mockResolvedValue({ ok: true }),
  getRolesAction: jest.fn().mockResolvedValue([]),
  getAppPermissionsAction: jest.fn().mockResolvedValue([]),
  updateUserAction: jest.fn().mockResolvedValue({}),
  deleteUserAction: jest.fn().mockResolvedValue({ ok: true }),
}))

const mockUser: User = {
  id: '1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com',
  status: 'active', orgId: 'org1', phoneNumber: null, username: null,
  createdAt: new Date().toISOString(), lastLoginAt: null,
}

describe('UserViewDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    render(<UserViewDrawer user={mockUser} orgs={[]} open={false} onOpenChange={() => {}} />)
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument()
  })

  it('renders user name when open', async () => {
    render(<UserViewDrawer user={mockUser} orgs={[]} open={true} onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument())
  })

  it('shows roles after loading', async () => {
    render(<UserViewDrawer user={mockUser} orgs={[]} open={true} onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument())
  })

  it('renders Delete button and opens AlertDialog', async () => {
    render(<UserViewDrawer user={mockUser} orgs={[]} open={true} onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'users.actions.delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/Alice Smith/)
  })

  const orgsProp = [{ id: 'org1', name: 'Org One', appId: 'app1', isPlatform: false }]

  it('renders Direct Permissions in the view-mode access grid', async () => {
    const actions = await import('@/app/(admin)/users/actions')
    ;(actions.getUserDirectPermissionsAction as jest.Mock).mockResolvedValueOnce([
      { id: 'p-direct', name: 'apps.write', appId: '' },
    ])
    render(<UserViewDrawer user={mockUser} orgs={orgsProp} open onOpenChange={() => {}} />)
    expect(await screen.findByText('users.drawer.assignedDirectPermissions')).toBeInTheDocument()
    expect(await screen.findByText('apps.write')).toBeInTheDocument()
  })

  it('Save fires setUserRolesAction with the new set when roles change', async () => {
    const actions = await import('@/app/(admin)/users/actions')
    ;(actions.getRolesAction as jest.Mock).mockResolvedValueOnce([
      { publicId: 'r1', name: 'admin', appId: 'app1' },
      { publicId: 'r2', name: 'viewer', appId: 'app1' },
    ])
    ;(actions.setUserRolesAction as jest.Mock).mockResolvedValueOnce({ ok: true })

    render(<UserViewDrawer user={mockUser} orgs={orgsProp} open onOpenChange={() => {}} />)
    // Wait for initial fetch
    await screen.findByText('admin')

    fireEvent.click(screen.getByRole('button', { name: 'users.drawer.edit' }))
    // Wait for edit-mode options to load (getRolesAction), then add a row
    fireEvent.click(await screen.findByRole('button', { name: /users\.fields\.addRole/ }))
    const roleSelects = await screen.findAllByLabelText('users.fields.roleRow')
    fireEvent.change(roleSelects[1], { target: { value: 'r2' } })

    fireEvent.click(screen.getByRole('button', { name: 'users.drawer.save' }))

    await waitFor(() => {
      expect(actions.setUserRolesAction).toHaveBeenCalledWith(
        '1', expect.arrayContaining(['r1', 'r2']),
      )
    })
  })

  it('Save fires setUserDirectPermissionsAction with the new set when perms change', async () => {
    const actions = await import('@/app/(admin)/users/actions')
    ;(actions.getUserDirectPermissionsAction as jest.Mock).mockResolvedValueOnce([
      { id: 'p1', name: 'apps.write', appId: '' },
    ])
    ;(actions.getAppPermissionsAction as jest.Mock).mockResolvedValueOnce([
      { publicId: 'p1', name: 'apps.write' },
      { publicId: 'p2', name: 'apps.read' },
    ])
    ;(actions.setUserDirectPermissionsAction as jest.Mock).mockResolvedValueOnce({ ok: true })

    render(<UserViewDrawer user={mockUser} orgs={orgsProp} open onOpenChange={() => {}} />)
    await screen.findByText('apps.write')

    fireEvent.click(screen.getByRole('button', { name: 'users.drawer.edit' }))
    fireEvent.click(await screen.findByRole('button', { name: /roles\.fields\.addPermission/ }))
    const permSelects = await screen.findAllByLabelText('roles.fields.permissionRow')
    fireEvent.change(permSelects[1], { target: { value: 'p2' } })

    fireEvent.click(screen.getByRole('button', { name: 'users.drawer.save' }))

    await waitFor(() => {
      expect(actions.setUserDirectPermissionsAction).toHaveBeenCalledWith(
        '1', expect.arrayContaining(['p1', 'p2']),
      )
    })
  })

  it('Cancel restores roles to the pre-Edit snapshot', async () => {
    const actions = await import('@/app/(admin)/users/actions')
    ;(actions.getRolesAction as jest.Mock).mockResolvedValueOnce([
      { publicId: 'r1', name: 'admin', appId: 'app1' },
      { publicId: 'r2', name: 'viewer', appId: 'app1' },
    ])

    render(<UserViewDrawer user={mockUser} orgs={orgsProp} open onOpenChange={() => {}} />)
    await screen.findByText('admin')

    fireEvent.click(screen.getByRole('button', { name: 'users.drawer.edit' }))
    fireEvent.click(await screen.findByRole('button', { name: /users\.fields\.addRole/ }))
    const roleSelects = await screen.findAllByLabelText('users.fields.roleRow')
    fireEvent.change(roleSelects[1], { target: { value: 'r2' } })

    fireEvent.click(screen.getByRole('button', { name: 'users.drawer.cancel' }))

    // After cancel, back in view mode. "viewer" should NOT be in the badges.
    expect(screen.queryByText('viewer')).not.toBeInTheDocument()
  })
})
