import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConsentGateClient } from '../ConsentGateClient'

// This codebase does not have @testing-library/user-event installed (see
// signup-form.test.tsx); every component test drives interactions with
// fireEvent instead, so this test follows the same convention.
//
// t.rich (used for the consent checkbox labels, which embed a link around
// part of the copy) can't be expressed by the plain `(key) => key` mock, so
// it gets the same real-English-copy substitution as signup-form.test.tsx —
// the assertions below rely on the actual label text (e.g. /Privacy Policy/i).
const RICH_STRINGS: Record<string, string> = {
  'signup.acceptPrivacyPolicy': 'I have read and accept the <link>Privacy Policy</link>',
  'signup.acceptTerms': 'I have read and accept the <link>Terms and Conditions</link>',
  'signup.acceptGdpr': 'I have read and accept the <link>GDPR Disclosure</link>',
}

jest.mock('next-intl', () => {
  const t = (key: string) => key
  t.rich = (key: string, values: { link: (chunks: string) => ReactNode }) => {
    const template = RICH_STRINGS[key] ?? key
    const match = template.match(/^(.*)<link>(.*)<\/link>(.*)$/)
    if (!match) return template
    const [, before, linkText, after] = match
    return (
      <>
        {before}
        {values.link(linkText)}
        {after}
      </>
    )
  }
  return { useTranslations: () => t }
})

jest.mock('../actions', () => ({ acceptConsentAction: jest.fn() }))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { acceptConsentAction } = require('../actions') as { acceptConsentAction: jest.Mock }

describe('ConsentGateClient', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders one checkbox per outstanding document, each required and separate', () => {
    render(
      <ConsentGateClient
        appPublicId="sq_1"
        next="/authorize?client_id=sq_1"
        outstanding={[
          { documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
          { documentType: 'terms', url: 'https://a.example.com/terms' },
        ]}
      />,
    )
    expect(screen.getByRole('checkbox', { name: /Privacy Policy/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Terms and Conditions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'loginConsent.continue' })).toBeDisabled()
  })

  it('enables Continue only once every rendered checkbox is checked, and submits all documentTypes', async () => {
    acceptConsentAction.mockResolvedValue(undefined)
    render(
      <ConsentGateClient
        appPublicId="sq_1"
        next="/authorize?client_id=sq_1"
        outstanding={[{ documentType: 'terms', url: 'https://a.example.com/terms' }]}
      />,
    )
    const checkbox = screen.getByRole('checkbox', { name: /Terms and Conditions/i })
    const button = screen.getByRole('button', { name: 'loginConsent.continue' })
    expect(button).toBeDisabled()
    fireEvent.click(checkbox)
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() =>
      expect(acceptConsentAction).toHaveBeenCalledWith('sq_1', ['terms'], '/authorize?client_id=sq_1'),
    )
  })
})
