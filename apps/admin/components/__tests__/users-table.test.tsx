import { render, screen, fireEvent } from '@testing-library/react'
import { UsersTable } from '../users-table'
import type { User, Org } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('../user-view-drawer', () => ({
  UserViewDrawer: () => null,
}))

jest.mock('../user-create-drawer', () => ({
  UserCreateDrawer: () => null,
}))

const mockUsers: User[] = [
  { id: '1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', status: 'active', orgId: 'org1', phoneNumber: null, username: null },
  { id: '2', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com', status: 'pending', orgId: 'org1', phoneNumber: null, username: null },
]

const mockOrgs: Org[] = [{ id: 'org1', name: 'Acme Corp', appId: 'app1', isPlatform: true }]

describe('UsersTable', () => {
  it('renders user rows', () => {
    render(<UsersTable users={mockUsers} orgs={mockOrgs} />)
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
  })

  it('filters by search input', () => {
    render(<UsersTable users={mockUsers} orgs={mockOrgs} />)
    const searchInput = screen.getByPlaceholderText('users.search')
    fireEvent.change(searchInput, { target: { value: 'alice' } })
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument()
  })

  it('shows org name for user', () => {
    render(<UsersTable users={mockUsers} orgs={mockOrgs} />)
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0)
  })
})
