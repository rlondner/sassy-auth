import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { OrgsTable } from '../orgs-table'
import * as actions from '@/app/(admin)/orgs/actions'
import type { App, OrgRow } from '@/lib/types'

jest.mock('@/app/(admin)/orgs/actions', () => ({
  deleteOrgAction: jest.fn(),
  listOrgsAction: jest.fn(),
}))

const apps: App[] = [
  { publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false },
  { publicId: 'sq_2', name: 'SassyAuth', url: 'https://auth.example.com', isPlatform: true },
]

const initial = {
  items: [
    { publicId: 'sq_10', name: 'Acme', isPlatform: false, userCount: 3, app: { publicId: 'sq_1', name: 'Customer Portal' } },
    { publicId: 'sq_20', name: 'Platform Org', isPlatform: true, userCount: 1, app: { publicId: 'sq_2', name: 'SassyAuth' } },
  ] satisfies OrgRow[],
  total: 2, page: 1, pageSize: 25,
}

function withIntl(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>
}

describe('OrgsTable', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders rows from initial data', () => {
    render(withIntl(<OrgsTable initial={initial} apps={apps} />))
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Platform Org')).toBeInTheDocument()
  })

  it('clicking Delete on an ordinary org opens ConfirmDialog with the org name', async () => {
    render(withIntl(<OrgsTable initial={initial} apps={apps} />))
    const menuButtons = screen.getAllByRole('button', { name: /more/i })
    fireEvent.click(menuButtons[0])
    fireEvent.click(await screen.findByRole('menuitem', { name: en.orgs.actions.delete }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/Acme/)
  })

  it('app filter triggers listOrgsAction with appId', async () => {
    jest.useFakeTimers()
    ;(actions.listOrgsAction as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
    render(withIntl(<OrgsTable initial={initial} apps={apps} />))
    fireEvent.change(screen.getByLabelText(en.orgs.filter.appLabel), { target: { value: 'sq_1' } })
    jest.advanceTimersByTime(400)
    await waitFor(() => expect(actions.listOrgsAction).toHaveBeenCalledWith({ appId: 'sq_1', page: 1, pageSize: 25 }))
    jest.useRealTimers()
  })
})
