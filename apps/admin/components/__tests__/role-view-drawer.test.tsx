import { render, screen, waitFor } from '@testing-library/react'
import { RoleViewDrawer } from '../role-view-drawer'
import type { RoleRow } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params) return `${key}(${JSON.stringify(params)})`
    return key
  },
}))

jest.mock('@/app/(admin)/roles/actions', () => ({
  getRoleAction: jest.fn().mockResolvedValue({
    publicId: 'sq_r1', name: 'Editor',
    app: { publicId: 'sq_a1', name: 'Portal' },
    permissionCount: 2, userCount: 1,
    permissions: [
      { publicId: 'sq_p1', name: 'apps.read' },
      { publicId: 'sq_p2', name: 'apps.write' },
    ],
  }),
}))

const role: RoleRow = {
  publicId: 'sq_r1', name: 'Editor',
  app: { publicId: 'sq_a1', name: 'Portal' },
  permissionCount: 2, userCount: 1,
}

describe('RoleViewDrawer', () => {
  it('renders name + loads the permissions list', async () => {
    render(<RoleViewDrawer role={role} open={true} onOpenChange={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    expect(screen.getByText('Editor')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('apps.read')).toBeInTheDocument())
    expect(screen.getByText('apps.write')).toBeInTheDocument()
  })

  it('disables Delete with tooltip when in-use', async () => {
    render(<RoleViewDrawer role={role} open={true} onOpenChange={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    await waitFor(() => expect(screen.getByText('apps.read')).toBeInTheDocument())
    const del = screen.getByRole('button', { name: 'roles.actions.delete' })
    expect(del).toBeDisabled()
    expect(del).toHaveAttribute('title', expect.stringContaining('inUseTooltip'))
  })

  it('Delete is enabled when userCount is 0', async () => {
    const unused: RoleRow = { ...role, userCount: 0 }
    const detailUnused = {
      publicId: 'sq_r1', name: 'Editor',
      app: { publicId: 'sq_a1', name: 'Portal' },
      permissionCount: 0, userCount: 0, permissions: [],
    }
    jest.requireMock('@/app/(admin)/roles/actions').getRoleAction.mockResolvedValueOnce(detailUnused)
    render(<RoleViewDrawer role={unused} open={true} onOpenChange={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    await waitFor(() => expect(screen.getByText('roles.drawer.noPermissions')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'roles.actions.delete' })).not.toBeDisabled()
  })
})
