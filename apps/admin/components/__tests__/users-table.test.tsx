import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { UsersTable } from '../users-table'
import type { User, Org } from '@/lib/types'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/app/(admin)/users/actions', () => ({
  deleteUserAction: jest.fn().mockResolvedValue({ ok: true }),
}))

// Render just enough of the drawer to observe which snapshot of the user it
// was handed — that is what bug-0233 is about.
jest.mock('../user-view-drawer', () => ({
  UserViewDrawer: ({ user, open }: { user: { firstName: string; lastName: string } | null; open: boolean }) =>
    open && user ? <div data-testid="view-drawer">{`${user.firstName} ${user.lastName}`}</div> : null,
}))

jest.mock('../user-create-drawer', () => ({
  UserCreateDrawer: () => null,
}))

// Radix DropdownMenu does not open in jsdom (it depends on pointer-events
// detection which jsdom does not implement). Replace it with a trivial
// always-open passthrough so menu items are queryable. This preserves the
// test intent: verify that clicking "Delete" surfaces the ConfirmDialog
// scoped to the correct user.
jest.mock('@sassy-auth/ui', () => {
  const actual = jest.requireActual('@sassy-auth/ui')
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  const Trigger = ({ children, asChild: _asChild, ...rest }: { children?: React.ReactNode; asChild?: boolean }) =>
    React.isValidElement(children) ? React.cloneElement(children, rest as object) : <>{children}</>
  const Item = ({ children, onClick, className }: { children?: React.ReactNode; onClick?: (e: React.MouseEvent) => void; className?: string }) => (
    <div role="menuitem" tabIndex={-1} className={className} onClick={onClick}>{children}</div>
  )
  return {
    ...actual,
    DropdownMenu: Passthrough,
    DropdownMenuTrigger: Trigger,
    DropdownMenuContent: Passthrough,
    DropdownMenuItem: Item,
    DropdownMenuSeparator: () => <hr />,
    // SidebarTrigger calls useSidebar() which throws without a SidebarProvider.
    // Replace with a noop button so PageHeader can render in tests.
    SidebarTrigger: () => <button type="button" aria-label="Toggle Sidebar" />,
  }
})

const mockUsers: User[] = [
  { id: '1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', status: 'active', orgId: 'org1', phoneNumber: null, username: null },
  { id: '2', firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com', status: 'pending', orgId: 'org1', phoneNumber: null, username: null },
]

const mockOrgs: Org[] = [{ id: 'org1', name: 'Acme Corp', appId: 'app1', isPlatform: true }]

function withIntl(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>
}

describe('UsersTable', () => {
  it('renders user rows', () => {
    render(withIntl(<UsersTable users={mockUsers} orgs={mockOrgs} />))
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
  })

  it('filters by search input', () => {
    render(withIntl(<UsersTable users={mockUsers} orgs={mockOrgs} />))
    const searchInput = screen.getByPlaceholderText(en.users.search)
    fireEvent.change(searchInput, { target: { value: 'alice' } })
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument()
  })

  it('shows org name for user', () => {
    render(withIntl(<UsersTable users={mockUsers} orgs={mockOrgs} />))
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0)
  })

  // bug-0233: the bug-0206 rebase landed in apps/orgs/permissions/roles tables
  // but not here. After an in-drawer save, router.refresh() delivers new props
  // while `selectedUser` still points at the pre-edit snapshot, so the drawer
  // shows stale values until it is closed and reopened.
  it('rebases the open drawer selection when the users prop changes', async () => {
    const { rerender } = render(withIntl(<UsersTable users={mockUsers} orgs={mockOrgs} />))

    const editItems = await screen.findAllByRole('menuitem', { name: en.users.actions.edit })
    fireEvent.click(editItems[0])
    expect(screen.getByTestId('view-drawer')).toHaveTextContent('Alice Smith')

    const renamed = [{ ...mockUsers[0], firstName: 'Alicia' }, mockUsers[1]]
    rerender(withIntl(<UsersTable users={renamed} orgs={mockOrgs} />))

    expect(screen.getByTestId('view-drawer')).toHaveTextContent('Alicia Smith')
  })

  it('drops the drawer selection when the selected user disappears from the list', async () => {
    const { rerender } = render(withIntl(<UsersTable users={mockUsers} orgs={mockOrgs} />))

    const editItems = await screen.findAllByRole('menuitem', { name: en.users.actions.edit })
    fireEvent.click(editItems[0])
    expect(screen.getByTestId('view-drawer')).toBeInTheDocument()

    rerender(withIntl(<UsersTable users={[mockUsers[1]]} orgs={mockOrgs} />))

    expect(screen.queryByTestId('view-drawer')).not.toBeInTheDocument()
  })

  it('clicking Delete on a user opens ConfirmDialog with the user name', async () => {
    render(withIntl(<UsersTable users={mockUsers} orgs={mockOrgs} />))
    // With the Dropdown primitives mocked as passthroughs, every row's menu items
    // render in the DOM. The first Delete item belongs to the first row (Alice).
    const deleteItems = await screen.findAllByRole('menuitem', { name: en.users.actions.delete })
    fireEvent.click(deleteItems[0])
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/Alice Smith/)
  })

  // bug-0225: the search box had only a placeholder, which is not an accessible
  // name. (No page-size select here — this table has no pagination; see
  // bug-0235 for the 500-row truncation that leaves in its place.)
  it('exposes the search box with an accessible name', () => {
    render(withIntl(<UsersTable users={mockUsers} orgs={mockOrgs} />))
    expect(screen.getByRole('searchbox', { name: en.users.search })).toBeInTheDocument()
  })

})
