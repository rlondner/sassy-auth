import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RoleCreateDrawer } from '../role-create-drawer'
import type { App } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('@/app/(admin)/roles/actions', () => ({
  createRoleAction: jest.fn().mockResolvedValue({ role: { publicId: 'sq_r1', name: 'Editor', app: { publicId: 'sq_a1', name: 'Portal' }, permissionCount: 0, userCount: 0, permissions: [] } }),
  listAppPermissionsAction: jest.fn().mockResolvedValue([
    { publicId: 'sq_p1', name: 'apps.read' },
    { publicId: 'sq_p2', name: 'apps.write' },
  ]),
}))

const apps: App[] = [
  { publicId: 'sq_a1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false, requireTwoFactor: false },
]

describe('RoleCreateDrawer', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders form fields when open', () => {
    render(<RoleCreateDrawer apps={apps} open={true} onOpenChange={() => {}} />)
    expect(screen.getByLabelText('roles.fields.app')).toBeInTheDocument()
    expect(screen.getByLabelText('roles.fields.name')).toBeInTheDocument()
    expect(screen.getByText('roles.fields.selectAppFirst')).toBeInTheDocument()
  })

  it('loads the app permissions when an app is selected', async () => {
    const { listAppPermissionsAction } = jest.requireMock('@/app/(admin)/roles/actions')
    render(<RoleCreateDrawer apps={apps} open={true} onOpenChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('roles.fields.app'), { target: { value: 'sq_a1' } })
    await waitFor(() => expect(listAppPermissionsAction).toHaveBeenCalledWith('sq_a1'))
  })

  it('lets the user add a permission row and submit', async () => {
    const onOpenChange = jest.fn()
    const { createRoleAction, listAppPermissionsAction } = jest.requireMock('@/app/(admin)/roles/actions')
    render(<RoleCreateDrawer apps={apps} open={true} onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByLabelText('roles.fields.app'), { target: { value: 'sq_a1' } })
    await waitFor(() => expect(listAppPermissionsAction).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('roles.fields.name'), { target: { value: 'Editor' } })
    fireEvent.click(screen.getByRole('button', { name: /roles.fields.addPermission/ }))
    const rowSelect = await screen.findByLabelText('roles.fields.permissionRow')
    fireEvent.change(rowSelect, { target: { value: 'sq_p1' } })
    fireEvent.click(screen.getByRole('button', { name: 'roles.drawer.createTitle' }))
    await waitFor(() => expect(createRoleAction).toHaveBeenCalledWith({
      name: 'Editor', appId: 'sq_a1', permissionIds: ['sq_p1'],
    }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
