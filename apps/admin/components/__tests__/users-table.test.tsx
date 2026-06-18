import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { UsersTable } from '../users-table'
import type { User, Org } from '@/lib/types'

jest.mock('@/app/(admin)/users/actions', () => ({
  deleteUserAction: jest.fn().mockResolvedValue({ ok: true }),
}))

jest.mock('../user-view-drawer', () => ({
  UserViewDrawer: () => null,
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

import { TooltipProvider } from '@sassy-auth/ui'

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <TooltipProvider>{node}</TooltipProvider>
    </NextIntlClientProvider>
  )
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
})
