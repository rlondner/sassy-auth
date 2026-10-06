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

  it('renders a thin 4px bar rather than the taller debug height', () => {
    render(<PasswordStrengthMeter password="Aaaaaaaaaaa1" policy={POLICY} />)
    expect(screen.getByTestId('strength-segment-0')).toHaveClass('h-1')
    expect(screen.getByTestId('strength-segment-0')).not.toHaveClass('h-2.5')
  })

  it('colors lit segments red when only the weakest tier is met', () => {
    // Non-empty, below minLength, no other rule met — met=0 rules still
    // floors to 1 lit segment via Math.max(1, ...), landing in the red tier.
    render(<PasswordStrengthMeter password="a" policy={POLICY} />)
    expect(screen.getByTestId('strength-segment-0')).toHaveClass('bg-red-500')
  })

  it('colors lit segments orange in the middle tier', () => {
    // 12 lowercase chars: minLength + requireLowercase met (2 of 4 rules) —
    // rounds to 3 lit segments, the orange tier.
    render(<PasswordStrengthMeter password="aaaaaaaaaaaa" policy={POLICY} />)
    expect(screen.getByTestId('strength-segment-0')).toHaveClass('bg-orange-500')
    expect(screen.getByTestId('strength-segment-2')).toHaveClass('bg-orange-500')
  })

  it('colors lit segments green when every rule is met', () => {
    render(<PasswordStrengthMeter password="Aaaaaaaaaaa1" policy={POLICY} />)
    for (let i = 0; i < 5; i++) {
      expect(screen.getByTestId(`strength-segment-${i}`)).toHaveClass('bg-green-500')
    }
  })
})
