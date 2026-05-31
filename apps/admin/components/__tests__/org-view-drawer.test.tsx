import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { OrgViewDrawer } from '../org-view-drawer'
import type { OrgRow } from '@/lib/types'

const org: OrgRow = {
  publicId: 'sq_10', name: 'Acme', isPlatform: false, userCount: 3,
  app: { publicId: 'sq_1', name: 'Customer Portal' },
}
const platformOrg: OrgRow = {
  publicId: 'sq_20', name: 'Platform Org', isPlatform: true, userCount: 1,
  app: { publicId: 'sq_2', name: 'SassyAuth' },
}

function withIntl(node: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{node}</NextIntlClientProvider>
}

describe('OrgViewDrawer', () => {
  it('renders org name, parent app, public id, user count, and Edit/Delete for ordinary orgs', () => {
    render(withIntl(
      <OrgViewDrawer org={org} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />,
    ))
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Customer Portal')).toBeInTheDocument()
    expect(screen.getByText('sq_10')).toBeInTheDocument()
    expect(screen.getByText('3 users')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.orgs.fields.viewUsers })).toHaveAttribute('href', '/users?orgId=sq_10')
    expect(screen.getByRole('button', { name: en.orgs.actions.edit })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.orgs.actions.delete })).toBeInTheDocument()
  })

  it('hides Edit/Delete and shows Platform badge for platform orgs', () => {
    render(withIntl(
      <OrgViewDrawer org={platformOrg} open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined} />,
    ))
    expect(screen.queryByRole('button', { name: en.orgs.actions.edit })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.orgs.actions.delete })).not.toBeInTheDocument()
    expect(screen.getByText(en.orgs.badges.platform)).toBeInTheDocument()
  })

  it('renders "No users yet" when userCount is 0', () => {
    render(withIntl(
      <OrgViewDrawer
        org={{ ...org, userCount: 0 }}
        open onOpenChange={() => undefined} onEdit={() => undefined} onDelete={() => undefined}
      />,
    ))
    expect(screen.getByText('No users yet')).toBeInTheDocument()
  })
})
