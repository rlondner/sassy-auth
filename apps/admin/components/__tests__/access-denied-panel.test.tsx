import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { AccessDeniedPanel } from '../access-denied-panel'

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('AccessDeniedPanel', () => {
  it('renders translated title and body', () => {
    render(withIntl(<AccessDeniedPanel />))
    expect(screen.getByText(en.apps.accessDenied.title)).toBeInTheDocument()
    expect(screen.getByText(en.apps.accessDenied.body)).toBeInTheDocument()
  })
})
