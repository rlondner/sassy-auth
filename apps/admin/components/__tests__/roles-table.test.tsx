import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { RolesTable } from '../roles-table'
import * as actions from '@/app/(admin)/roles/actions'
import type { App, RoleRow } from '@/lib/types'

jest.mock('@/app/(admin)/roles/actions', () => ({
  deleteRoleAction: jest.fn(),
  listRolesAction: jest.fn(),
  getRoleAction: jest.fn(),
  createRoleAction: jest.fn(),
  updateRoleAction: jest.fn(),
  listAppPermissionsAction: jest.fn().mockResolvedValue([]),
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
    { publicId: 'sq_r1', name: 'Editor', app: { publicId: 'sq_a1', name: 'Customer Portal' }, permissionCount: 2, userCount: 0 },
    { publicId: 'sq_r2', name: 'Platform Admin', app: { publicId: 'sq_a2', name: 'SassyAuth' }, permissionCount: 5, userCount: 3 },
  ] satisfies RoleRow[],
  total: 2, page: 1, pageSize: 25,
}

function withIntl(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>
}

describe('RolesTable', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders rows with role names and app names', () => {
    render(withIntl(<RolesTable initial={initial} apps={apps} />))
    expect(screen.getByText('Editor')).toBeInTheDocument()
    expect(screen.getByText('Platform Admin')).toBeInTheDocument()
    // "Customer Portal" appears in the row AND in the filter <option>; assert >=1.
    expect(screen.getAllByText('Customer Portal').length).toBeGreaterThan(0)
  })

  it('shows View/Edit/Delete menu items per row', () => {
    render(withIntl(<RolesTable initial={initial} apps={apps} />))
    expect(screen.getAllByRole('menuitem', { name: en.roles.actions.view })).toHaveLength(2)
    expect(screen.getAllByRole('menuitem', { name: en.roles.actions.edit })).toHaveLength(2)
    expect(screen.getAllByRole('menuitem', { name: en.roles.actions.delete })).toHaveLength(2)
  })

  it('clicking Delete on the unassigned role opens AlertDialog with the role name', async () => {
    render(withIntl(<RolesTable initial={initial} apps={apps} />))
    // Editor is the row with userCount 0 (deletable).
    const deleteItems = screen.getAllByRole('menuitem', { name: en.roles.actions.delete })
    fireEvent.click(deleteItems[0])
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/Editor/)
  })

  it('Delete on an in-use role is disabled (no AlertDialog opens)', () => {
    render(withIntl(<RolesTable initial={initial} apps={apps} />))
    const deleteItems = screen.getAllByRole('menuitem', { name: en.roles.actions.delete })
    // Second row (Platform Admin) has userCount 3.
    fireEvent.click(deleteItems[1])
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('app filter triggers listRolesAction with appId', async () => {
    jest.useFakeTimers()
    ;(actions.listRolesAction as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    render(withIntl(<RolesTable initial={initial} apps={apps} />))
    fireEvent.change(screen.getByLabelText(en.roles.filter.appLabel), { target: { value: 'sq_a1' } })
    jest.advanceTimersByTime(400)
    await waitFor(() => expect(actions.listRolesAction).toHaveBeenCalledWith({ appId: 'sq_a1', page: 1, pageSize: 25 }))
    jest.useRealTimers()
  })

  it('hides Create/Edit/Delete affordances when canWrite=false', () => {
    render(withIntl(<RolesTable initial={initial} apps={apps} canWrite={false} />))
    expect(screen.queryByRole('button', { name: new RegExp(en.roles.create) })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('menuitem', { name: en.roles.actions.edit })).toHaveLength(0)
    expect(screen.queryAllByRole('menuitem', { name: en.roles.actions.delete })).toHaveLength(0)
    // View should remain visible.
    expect(screen.getAllByRole('menuitem', { name: en.roles.actions.view })).toHaveLength(2)
  })

  it('hides the app picker when canPickApp=false', () => {
    render(withIntl(<RolesTable initial={initial} apps={apps} canPickApp={false} />))
    expect(screen.queryByLabelText(en.roles.filter.appLabel)).not.toBeInTheDocument()
  })
})
