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
}

describe('UserViewDrawer', () => {
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
})
