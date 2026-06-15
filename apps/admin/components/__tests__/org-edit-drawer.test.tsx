import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { TooltipProvider } from '@sassy-auth/ui'
import en from '@/messages/en.json'
import { OrgEditDrawer } from '../org-edit-drawer'
import * as actions from '@/app/(admin)/orgs/actions'
import type { OrgRow } from '@/lib/types'

jest.mock('@/app/(admin)/orgs/actions', () => ({ updateOrgAction: jest.fn() }))
Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } })

const org: OrgRow = {
  publicId: 'sq_10', name: 'Old', isPlatform: false, userCount: 0,
  app: { publicId: 'sq_1', name: 'Customer Portal' },
}

function withIntl(node: React.ReactNode) {
  return (<NextIntlClientProvider locale="en" messages={en}><TooltipProvider>{node}</TooltipProvider></NextIntlClientProvider>)
}

describe('OrgEditDrawer', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders parent app as read-only and the publicId copy button', async () => {
    render(withIntl(<OrgEditDrawer org={org} open onOpenChange={() => undefined} />))
    expect(screen.getByText('Customer Portal')).toBeInTheDocument()
    expect(screen.getByText(en.orgs.fields.appReadOnlyHint)).toBeInTheDocument()
    const pubInput = screen.getByDisplayValue('sq_10') as HTMLInputElement
    expect(pubInput.readOnly).toBe(true)
  })

  it('disables Save when no fields are dirty and enables after edit', () => {
    render(withIntl(<OrgEditDrawer org={org} open onOpenChange={() => undefined} />))
    const save = screen.getByRole('button', { name: en.orgs.drawer.save })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText(en.orgs.fields.name), { target: { value: 'New' } })
    expect(save).toBeEnabled()
  })

  it('submits patch via updateOrgAction', async () => {
    ;(actions.updateOrgAction as jest.Mock).mockResolvedValue({
      org: { ...org, name: 'New' },
    })
    const onOpenChange = jest.fn()
    render(withIntl(<OrgEditDrawer org={org} open onOpenChange={onOpenChange} />))
    fireEvent.change(screen.getByLabelText(en.orgs.fields.name), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: en.orgs.drawer.save }))
    await waitFor(() =>
      expect(actions.updateOrgAction).toHaveBeenCalledWith('sq_10', { name: 'New' }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
