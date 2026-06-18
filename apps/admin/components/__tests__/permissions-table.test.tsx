import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { PermissionsTable } from '../permissions-table'
import * as actions from '@/app/(admin)/permissions/actions'
import type { App, PermissionRow } from '@/lib/types'

jest.mock('@/app/(admin)/permissions/actions', () => ({
  deletePermissionAction: jest.fn(),
  listPermissionsAction: jest.fn(),
  getPermissionAction: jest.fn(),
}))

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
    SidebarTrigger: () => <button type="button" aria-label="Toggle Sidebar" />,
  }
})

const apps: App[] = [
  { publicId: 'sq_a1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false },
  { publicId: 'sq_a2', name: 'SassyAuth', url: 'https://auth.example.com', isPlatform: true },
]

const initial = {
  items: [
    { publicId: 'sq_p1', name: 'apps.read', app: { publicId: 'sq_a1', name: 'Customer Portal' }, roleCount: 0, userCount: 0 },
    { publicId: 'sq_p2', name: 'platform.users.manage', app: { publicId: 'sq_a2', name: 'SassyAuth' }, roleCount: 1, userCount: 0 },
  ] satisfies PermissionRow[],
  total: 2, page: 1, pageSize: 25,
}

function withIntl(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>
}

describe('PermissionsTable', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders rows with names and the Platform badge for platform.*', () => {
    render(withIntl(<PermissionsTable initial={initial} apps={apps} />))
    expect(screen.getByText('apps.read')).toBeInTheDocument()
    expect(screen.getByText('platform.users.manage')).toBeInTheDocument()
    expect(screen.getByText(en.permissions.badges.platform)).toBeInTheDocument()
  })

  it('Edit and Delete menu items are hidden for platform.* rows', () => {
    render(withIntl(<PermissionsTable initial={initial} apps={apps} />))
    // With Dropdown mocked as passthrough, every row's items are in the DOM.
    // The platform.* row contributes 1 menuitem ("View"). The non-platform
    // row contributes 3 ("View", "Edit", "Delete"). Total = 4.
    expect(screen.getAllByRole('menuitem')).toHaveLength(4)
    expect(screen.getAllByRole('menuitem', { name: en.permissions.actions.view })).toHaveLength(2)
    expect(screen.getAllByRole('menuitem', { name: en.permissions.actions.edit })).toHaveLength(1)
    expect(screen.getAllByRole('menuitem', { name: en.permissions.actions.delete })).toHaveLength(1)
  })

  it('clicking Delete opens AlertDialog with the permission name', async () => {
    render(withIntl(<PermissionsTable initial={initial} apps={apps} />))
    const deleteItems = screen.getAllByRole('menuitem', { name: en.permissions.actions.delete })
    fireEvent.click(deleteItems[0])
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/apps\.read/)
  })

  it('app filter triggers listPermissionsAction with appId', async () => {
    jest.useFakeTimers()
    ;(actions.listPermissionsAction as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    render(withIntl(<PermissionsTable initial={initial} apps={apps} />))
    fireEvent.change(screen.getByLabelText(en.permissions.filter.appLabel), { target: { value: 'sq_a1' } })
    jest.advanceTimersByTime(400)
    await waitFor(() => expect(actions.listPermissionsAction).toHaveBeenCalledWith({ appId: 'sq_a1', page: 1, pageSize: 25 }))
    jest.useRealTimers()
  })
})
