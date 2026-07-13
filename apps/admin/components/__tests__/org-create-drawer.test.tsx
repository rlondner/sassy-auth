import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { OrgCreateDrawer } from '../org-create-drawer'
import * as actions from '@/app/(admin)/orgs/actions'
import type { App } from '@/lib/types'

jest.mock('@/app/(admin)/orgs/actions', () => ({
  createOrgAction: jest.fn(),
}))

const apps: App[] = [
  { publicId: 'sq_1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false, requireTwoFactor: false },
  { publicId: 'sq_2', name: 'SassyAuth', url: 'https://auth.example.com', isPlatform: true, requireTwoFactor: false },
]

function withIntl(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>
}

describe('OrgCreateDrawer', () => {
  beforeEach(() => jest.clearAllMocks())

  it('submits valid form with selected appId and closes', async () => {
    ;(actions.createOrgAction as jest.Mock).mockResolvedValue({
      org: { publicId: 'sq_10', name: 'Acme', isPlatform: false, userCount: 0, app: { publicId: 'sq_1', name: 'Customer Portal' } },
    })
    const onOpenChange = jest.fn()
    render(withIntl(<OrgCreateDrawer apps={apps} open onOpenChange={onOpenChange} />))
    fireEvent.change(screen.getByLabelText(en.orgs.fields.app), { target: { value: 'sq_1' } })
    fireEvent.change(screen.getByLabelText(en.orgs.fields.name), { target: { value: 'Acme' } })
    fireEvent.click(screen.getByRole('button', { name: en.orgs.drawer.createTitle }))
    await waitFor(() =>
      expect(actions.createOrgAction).toHaveBeenCalledWith({ name: 'Acme', appId: 'sq_1' }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('surfaces 409 nameExists error inline', async () => {
    ;(actions.createOrgAction as jest.Mock).mockResolvedValue({ errorKey: 'orgs.errors.nameExists' })
    render(withIntl(<OrgCreateDrawer apps={apps} open onOpenChange={() => undefined} />))
    fireEvent.change(screen.getByLabelText(en.orgs.fields.app), { target: { value: 'sq_1' } })
    fireEvent.change(screen.getByLabelText(en.orgs.fields.name), { target: { value: 'Dup' } })
    fireEvent.click(screen.getByRole('button', { name: en.orgs.drawer.createTitle }))
    await waitFor(() => expect(screen.getByText(en.orgs.errors.nameExists)).toBeInTheDocument())
  })

  it('shows the no-apps notice when only platform apps exist', () => {
    render(withIntl(<OrgCreateDrawer apps={[apps[1]]} open onOpenChange={() => undefined} />))
    expect(screen.getByText(en.orgs.drawer.noNonPlatformApps)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.orgs.drawer.createTitle })).toBeDisabled()
  })
})
