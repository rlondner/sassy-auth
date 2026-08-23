import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import { SocialButtons } from '@/app/login/social-buttons'

function renderWith(providers: string[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SocialButtons providers={providers} next="/api/token/oauth/authorize?client_id=qp31" />
    </NextIntlClientProvider>,
  )
}

describe('SocialButtons', () => {
  it('renders nothing when no providers are enabled', () => {
    const { container } = renderWith([])
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one button per enabled provider', () => {
    renderWith(['google', 'microsoft'])
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /microsoft/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /apple/i })).not.toBeInTheDocument()
  })

  it('renders the divider only when there is at least one provider', () => {
    renderWith(['google'])
    expect(screen.getByText(messages.login.socialDivider)).toBeInTheDocument()
  })
})
