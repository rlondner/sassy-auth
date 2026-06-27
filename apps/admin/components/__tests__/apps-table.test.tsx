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
