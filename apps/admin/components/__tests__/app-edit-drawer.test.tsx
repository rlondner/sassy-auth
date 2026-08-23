import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { AppEditDrawer } from '../app-edit-drawer'
import * as actions from '@/app/(admin)/apps/actions'

jest.mock('@/app/(admin)/apps/actions', () => ({
  updateAppAction: jest.fn(),
  getSocialProvidersAction: jest.fn(),
  updateSocialProvidersAction: jest.fn(),
}))
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
  beforeEach(() => {
    jest.clearAllMocks()
    ;(actions.getSocialProvidersAction as jest.Mock).mockResolvedValue({ providers: [] })
  })

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

  it('renders social sign-in checkboxes from the fetched list, checked by default', async () => {
    ;(actions.getSocialProvidersAction as jest.Mock).mockResolvedValue({
      providers: ['google', 'microsoft'],
    })
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    await waitFor(() =>
      expect(actions.getSocialProvidersAction).toHaveBeenCalledWith('sq_1'),
    )
    const google = (await screen.findByLabelText(en.apps.fields.socialProviderNames.google)) as HTMLInputElement
    const microsoft = screen.getByLabelText(en.apps.fields.socialProviderNames.microsoft) as HTMLInputElement
    expect(google.checked).toBe(true)
    expect(microsoft.checked).toBe(true)
  })

  it('unchecking a provider submits a providers array without it', async () => {
    ;(actions.getSocialProvidersAction as jest.Mock).mockResolvedValue({
      providers: ['google', 'microsoft'],
    })
    ;(actions.updateSocialProvidersAction as jest.Mock).mockResolvedValue({
      providers: ['google'],
    })
    const onOpenChange = jest.fn()
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={onOpenChange} />))
    const microsoft = await screen.findByLabelText(en.apps.fields.socialProviderNames.microsoft)
    fireEvent.click(microsoft)

    const save = screen.getByRole('button', { name: en.apps.drawer.save })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() =>
      expect(actions.updateSocialProvidersAction).toHaveBeenCalledWith('sq_1', ['google']),
    )
    expect(actions.updateAppAction).not.toHaveBeenCalled()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
