import { render, screen, waitFor } from '@testing-library/react'
import { PermissionViewDrawer } from '../permission-view-drawer'
import type { PermissionRow } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params) return `${key}(${JSON.stringify(params)})`
    return key
  },
}))

jest.mock('@/app/(admin)/permissions/actions', () => ({
  getPermissionAction: jest.fn().mockResolvedValue({
    publicId: 'sq_p1', name: 'apps.read',
    app: { publicId: 'sq_a1', name: 'Portal' },
    roleCount: 2, userCount: 1,
    roles: [
      { publicId: 'sq_r1', name: 'Editor', appName: 'Portal' },
      { publicId: 'sq_r2', name: 'Viewer', appName: 'Portal' },
    ],
    users: [
      { publicId: 'sq_u1', email: 'alice@example.com', firstName: 'Alice', lastName: 'Smith' },
    ],
  }),
}))

const permission: PermissionRow = {
  publicId: 'sq_p1', name: 'apps.read',
  app: { publicId: 'sq_a1', name: 'Portal' },
  roleCount: 2, userCount: 1,
}

describe('PermissionViewDrawer', () => {
  it('renders name + app and loads the role/user lists', async () => {
    render(<PermissionViewDrawer permission={permission} open={true} onOpenChange={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    expect(screen.getByText('apps.read')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Editor')).toBeInTheDocument())
    expect(screen.getByText('Viewer')).toBeInTheDocument()
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  })

  it('shows the Platform badge for platform.* permissions', () => {
    const platformPerm: PermissionRow = { ...permission, name: 'platform.users.manage' }
    render(<PermissionViewDrawer permission={platformPerm} open={true} onOpenChange={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    expect(screen.getByText('permissions.badges.platform')).toBeInTheDocument()
    // Edit/Delete buttons are absent for platform.*
    expect(screen.queryByRole('button', { name: 'permissions.actions.edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'permissions.actions.delete' })).not.toBeInTheDocument()
  })

  it('disables Delete and surfaces tooltip when in-use', async () => {
    render(<PermissionViewDrawer permission={permission} open={true} onOpenChange={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    await waitFor(() => expect(screen.getByText('Editor')).toBeInTheDocument())
    const del = screen.getByRole('button', { name: 'permissions.actions.delete' })
    expect(del).toBeDisabled()
    expect(del).toHaveAttribute('title', expect.stringContaining('inUseTooltip'))
  })
})
