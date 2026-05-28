import * as React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { UserViewDrawer } from '../user-view-drawer'
import type { User } from '@/lib/types'

jest.mock('@/lib/api', () => ({
  getUserRoles: jest.fn().mockResolvedValue([{ id: 'r1', name: 'admin', appId: 'app1' }]),
  getEffectivePermissions: jest.fn().mockResolvedValue([{ id: 'p1', name: 'users.read', appId: 'app1' }]),
  updateUser: jest.fn().mockResolvedValue({}),
}))

jest.mock('@/app/(admin)/users/actions', () => ({
  deleteUserAction: jest.fn().mockResolvedValue({ ok: true }),
}))

const mockUser: User = {
  id: '1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com',
  status: 'active', orgId: 'org1', phoneNumber: null, username: null,
}

function withIntl(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>
}

describe('UserViewDrawer', () => {
  it('renders nothing when closed', () => {
    render(withIntl(<UserViewDrawer user={mockUser} open={false} onOpenChange={() => {}} />))
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument()
  })

  it('renders user name when open', async () => {
    render(withIntl(<UserViewDrawer user={mockUser} open={true} onOpenChange={() => {}} />))
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument())
  })

  it('shows roles after loading', async () => {
    render(withIntl(<UserViewDrawer user={mockUser} open={true} onOpenChange={() => {}} />))
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument())
  })

  it('renders Delete button and opens ConfirmDialog', async () => {
    render(withIntl(<UserViewDrawer user={mockUser} open={true} onOpenChange={() => {}} />))
    fireEvent.click(screen.getByRole('button', { name: en.users.actions.delete }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/Alice Smith/)
  })
})
