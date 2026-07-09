import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RoleEditDrawer } from '../role-edit-drawer'
import type { RoleRow } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('@/app/(admin)/roles/actions', () => ({
  updateRoleAction: jest.fn().mockResolvedValue({ role: { publicId: 'sq_r1', name: 'Editor v2', app: { publicId: 'sq_a1', name: 'Portal' }, permissionCount: 1, userCount: 0, permissions: [{ publicId: 'sq_p1', name: 'apps.read' }] } }),
  getRoleAction: jest.fn().mockResolvedValue({
    publicId: 'sq_r1', name: 'Editor', app: { publicId: 'sq_a1', name: 'Portal' },
    permissionCount: 1, userCount: 0,
    permissions: [{ publicId: 'sq_p1', name: 'apps.read' }],
  }),
  listAppPermissionsAction: jest.fn().mockResolvedValue([
    { publicId: 'sq_p1', name: 'apps.read' },
    { publicId: 'sq_p2', name: 'apps.write' },
  ]),
}))

const role: RoleRow = {
  publicId: 'sq_r1', name: 'Editor',
  app: { publicId: 'sq_a1', name: 'Portal' },
  permissionCount: 1, userCount: 0,
}

describe('RoleEditDrawer', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders name and read-only app + immutability hint', async () => {
    render(<RoleEditDrawer role={role} open={true} onOpenChange={() => {}} />)
    expect(screen.getByDisplayValue('Editor')).toBeInTheDocument()
    expect(screen.getByText('Portal')).toBeInTheDocument()
    expect(screen.getByText('roles.fields.appImmutable')).toBeInTheDocument()
    await waitFor(() => expect(jest.requireMock('@/app/(admin)/roles/actions').getRoleAction).toHaveBeenCalledWith('sq_r1'))
  })

  it('Save is disabled until something changes', async () => {
    render(<RoleEditDrawer role={role} open={true} onOpenChange={() => {}} />)
    await waitFor(() => expect(jest.requireMock('@/app/(admin)/roles/actions').getRoleAction).toHaveBeenCalled())
    const save = screen.getByRole('button', { name: 'roles.drawer.save' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByDisplayValue('Editor'), { target: { value: 'Editor v2' } })
    expect(save).not.toBeDisabled()
  })

  it('submits name change and closes on success', async () => {
    const onOpenChange = jest.fn()
    const { updateRoleAction } = jest.requireMock('@/app/(admin)/roles/actions')
    render(<RoleEditDrawer role={role} open={true} onOpenChange={onOpenChange} />)
    await waitFor(() => expect(jest.requireMock('@/app/(admin)/roles/actions').getRoleAction).toHaveBeenCalled())
    fireEvent.change(screen.getByDisplayValue('Editor'), { target: { value: 'Editor v2' } })
    fireEvent.click(screen.getByRole('button', { name: 'roles.drawer.save' }))
    await waitFor(() => expect(updateRoleAction).toHaveBeenCalledWith('sq_r1', { name: 'Editor v2' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
