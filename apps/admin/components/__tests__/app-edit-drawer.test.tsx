import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { AppEditDrawer } from '../app-edit-drawer'
import * as actions from '@/app/(admin)/apps/actions'

jest.mock('@/app/(admin)/apps/actions', () => ({ updateAppAction: jest.fn() }))
Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } })

const app = { publicId: 'sq_1', name: 'Old', url: 'https://old.example', isPlatform: false, requireTwoFactor: false }

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('AppEditDrawer', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders the publicId as read-only and copies on click', async () => {
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    const pubInput = screen.getByDisplayValue('sq_1') as HTMLInputElement
    expect(pubInput.readOnly).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.apps.actions.copy }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sq_1'))
  })

  it('disables Save when no fields are dirty and enables after edit', () => {
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    const save = screen.getByRole('button', { name: en.apps.drawer.save })
    expect(save).toBeDisabled()
    const nameInput = screen.getByLabelText(en.apps.fields.name) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'New' } })
    expect(save).toBeEnabled()
  })

  it('submits patch via updateAppAction', async () => {
    ;(actions.updateAppAction as jest.Mock).mockResolvedValue({
      app: { ...app, name: 'New' },
    })
    const onOpenChange = jest.fn()
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={onOpenChange} />))
    fireEvent.change(screen.getByLabelText(en.apps.fields.name), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.save }))
    await waitFor(() =>
      expect(actions.updateAppAction).toHaveBeenCalledWith('sq_1', { name: 'New' }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('validates empty name and url separately', async () => {
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    const nameInput = screen.getByLabelText(en.apps.fields.name) as HTMLInputElement
    const urlInput = screen.getByLabelText(en.apps.fields.url) as HTMLInputElement
    const save = screen.getByRole('button', { name: en.apps.drawer.save })

    // Empty name
    fireEvent.change(nameInput, { target: { value: '' } })
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByText(en.apps.errors.nameRequired)).toBeInTheDocument())

    // Valid name, empty url
    fireEvent.change(nameInput, { target: { value: 'Valid Name' } })
    fireEvent.change(urlInput, { target: { value: '' } })
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByText(en.apps.errors.urlRequired)).toBeInTheDocument())
  })
})
