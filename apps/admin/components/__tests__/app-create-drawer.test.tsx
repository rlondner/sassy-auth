import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { AppCreateDrawer } from '../app-create-drawer'
import * as actions from '@/app/(admin)/apps/actions'

jest.mock('@/app/(admin)/apps/actions', () => ({
  createAppAction: jest.fn(),
}))

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('AppCreateDrawer', () => {
  beforeEach(() => jest.clearAllMocks())

  it('submits valid form and closes', async () => {
    ;(actions.createAppAction as jest.Mock).mockResolvedValue({
      app: { publicId: 'sq_1', name: 'X', url: 'https://x.example', isPlatform: false },
    })
    const onOpenChange = jest.fn()
    render(withIntl(<AppCreateDrawer open onOpenChange={onOpenChange} />))
    fireEvent.change(screen.getByLabelText(en.apps.fields.name, { exact: false }), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.url, { exact: false }), { target: { value: 'https://x.example' } })
    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.createTitle }))
    await waitFor(() =>
      expect(actions.createAppAction).toHaveBeenCalledWith({
        name: 'X',
        url: 'https://x.example',
        callbackUrl: null,
        requireTwoFactor: false,
        twoFactorTrustDays: null,
      }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('surfaces 409 nameExists error inline', async () => {
    ;(actions.createAppAction as jest.Mock).mockResolvedValue({ errorKey: 'apps.errors.nameExists' })
    render(withIntl(<AppCreateDrawer open onOpenChange={() => undefined} />))
    fireEvent.change(screen.getByLabelText(en.apps.fields.name, { exact: false }), { target: { value: 'Dup' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.url, { exact: false }), { target: { value: 'https://x.example' } })
    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.createTitle }))
    await waitFor(() => expect(screen.getByText(en.apps.errors.nameExists)).toBeInTheDocument())
  })

  it('surfaces custom client-side validation error when name is empty', async () => {
    render(withIntl(<AppCreateDrawer open onOpenChange={() => undefined} />))
    // Leave name empty and fill URL
    fireEvent.change(screen.getByLabelText(en.apps.fields.url, { exact: false }), { target: { value: 'https://x.example' } })
    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.createTitle }))
    await waitFor(() => expect(screen.getByText(en.apps.errors.nameRequired)).toBeInTheDocument())
    expect(actions.createAppAction).not.toHaveBeenCalled()
  })

  it('surfaces custom client-side validation error when URL is empty', async () => {
    render(withIntl(<AppCreateDrawer open onOpenChange={() => undefined} />))
    // Fill name and leave URL empty
    fireEvent.change(screen.getByLabelText(en.apps.fields.name, { exact: false }), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.createTitle }))
    await waitFor(() => expect(screen.getByText(en.apps.errors.urlRequired)).toBeInTheDocument())
    expect(actions.createAppAction).not.toHaveBeenCalled()
  })
})
