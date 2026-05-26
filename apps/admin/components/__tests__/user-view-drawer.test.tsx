import { render, screen, waitFor } from '@testing-library/react'
import { UserViewDrawer } from '../user-view-drawer'
import type { User } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params) return `${key}(${JSON.stringify(params)})`
    return key
  },
}))

jest.mock('@/lib/api', () => ({
  getUserRoles: jest.fn().mockResolvedValue([{ id: 'r1', name: 'admin', appId: 'app1' }]),
  getEffectivePermissions: jest.fn().mockResolvedValue([{ id: 'p1', name: 'users.read', appId: 'app1' }]),
  updateUser: jest.fn().mockResolvedValue({}),
}))

const mockUser: User = {
  id: '1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com',
  status: 'active', orgId: 'org1', phoneNumber: null, username: null,
}

describe('UserViewDrawer', () => {
  it('renders nothing when closed', () => {
    render(<UserViewDrawer user={mockUser} open={false} onOpenChange={() => {}} />)
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument()
  })

  it('renders user name when open', async () => {
    render(<UserViewDrawer user={mockUser} open={true} onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument())
  })

  it('shows roles after loading', async () => {
    render(<UserViewDrawer user={mockUser} open={true} onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument())
  })
})
