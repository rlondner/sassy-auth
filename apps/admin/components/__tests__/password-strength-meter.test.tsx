import { render, screen } from '@testing-library/react'
import { PasswordStrengthMeter } from '../password-strength-meter'
import type { PasswordPolicy } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: false,
  minNumbers: 1,
  minSpecial: 0,
}

describe('PasswordStrengthMeter', () => {
  it('shows no lit segments and no label for an empty password', () => {
    render(<PasswordStrengthMeter password="" policy={POLICY} />)
    expect(screen.getByTestId('strength-segment-0')).toHaveClass('bg-muted')
    expect(screen.queryByText('weak')).not.toBeInTheDocument()
  })

  it('lights more segments as more rules are satisfied', () => {
    render(<PasswordStrengthMeter password="aaaaaaaaaaaa" policy={POLICY} />)
    // Only minLength is met (12 chars, no upper/number) — the weakest tier.
    expect(screen.getByTestId('strength-segment-0')).not.toHaveClass('bg-muted')
    expect(screen.getByTestId('strength-segment-4')).toHaveClass('bg-muted')
  })

  it('lights every segment for a password meeting every rule', () => {
    render(<PasswordStrengthMeter password="Aaaaaaaaaaa1" policy={POLICY} />)
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`strength-segment-${i}`)).not.toHaveClass('bg-muted')
    }
    expect(screen.getByText('veryStrong')).toBeInTheDocument()
  })
})
