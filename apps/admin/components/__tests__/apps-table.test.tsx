import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { AppsTable } from '../apps-table'
import * as actions from '@/app/(admin)/apps/actions'

jest.mock('@/app/(admin)/apps/actions', () => ({
  deleteAppAction: jest.fn(),
  listAppsAction: jest.fn(),
}))

// Radix DropdownMenu does not open in jsdom (it depends on pointer-events
// detection which jsdom does not implement). Replace it with a trivial
// always-open passthrough so menu items are queryable. This preserves the
// test intent: verify that clicking "Delete" surfaces the ConfirmDialog
// scoped to the correct app.
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
    Tooltip: Passthrough,
    TooltipTrigger: Passthrough,
    TooltipContent: () => null,
    TooltipProvider: Passthrough,
  }
})

const initial = {
  items: [
    { publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false },
    { publicId: 'sq_2', name: 'SassyAuth', url: 'https://auth.example.com', isPlatform: true },
  ],
  total: 2,
  page: 1,
  pageSize: 25,
}

function withIntl(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>
}

describe('AppsTable', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders rows from initial data', () => {
    render(withIntl(<AppsTable initial={initial} />))
    expect(screen.getByText('Customer Portal')).toBeInTheDocument()
    expect(screen.getByText('SassyAuth')).toBeInTheDocument()
  })

  it('clicking Delete on an ordinary app opens ConfirmDialog with the app name', async () => {
    render(withIntl(<AppsTable initial={initial} />))
    // Open the row action menu for Customer Portal (first row)
    const menuButtons = screen.getAllByRole('button', { name: /more/i })
    fireEvent.click(menuButtons[0])
    fireEvent.click(await screen.findByRole('menuitem', { name: en.apps.actions.delete }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/Customer Portal/)
  })

  it('debounced search triggers listAppsAction with q', async () => {
    jest.useFakeTimers()
    ;(actions.listAppsAction as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    render(withIntl(<AppsTable initial={initial} />))
    fireEvent.change(screen.getByPlaceholderText(en.apps.search), { target: { value: 'port' } })
    jest.advanceTimersByTime(400)
    await waitFor(() => expect(actions.listAppsAction).toHaveBeenCalledWith({ q: 'port', page: 1, pageSize: 25 }))
    jest.useRealTimers()
  })
})
