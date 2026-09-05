import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { PasswordRequirementsChecklist } from '../password-requirements-checklist'
import type { PasswordPolicy } from '@/lib/types'

const POLICY: PasswordPolicy = {
  minLength: 12, requireUppercase: true, requireLowercase: true,
  requireNumber: true, requireSpecial: false, minNumbers: 1, minSpecial: 0,
}

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('PasswordRequirementsChecklist', () => {
  it('renders one item per active rule', () => {
    render(withIntl(<PasswordRequirementsChecklist password="" policy={POLICY} />))
    expect(screen.getByTestId('rule-minLength')).toBeInTheDocument()
    expect(screen.getByTestId('rule-requireUppercase')).toBeInTheDocument()
    expect(screen.getByTestId('rule-requireLowercase')).toBeInTheDocument()
    expect(screen.getByTestId('rule-requireNumber')).toBeInTheDocument()
    expect(screen.queryByTestId('rule-requireSpecial')).not.toBeInTheDocument()
  })

  it('marks a rule as met once the password satisfies it', () => {
    render(withIntl(<PasswordRequirementsChecklist password="Str0ngPassword" policy={POLICY} />))
    expect(screen.getByTestId('rule-minLength')).toHaveAttribute('data-met', 'true')
    expect(screen.getByTestId('rule-requireUppercase')).toHaveAttribute('data-met', 'true')
  })

  it('marks a rule as unmet when the password fails it', () => {
    render(withIntl(<PasswordRequirementsChecklist password="alllowercase" policy={POLICY} />))
    expect(screen.getByTestId('rule-requireUppercase')).toHaveAttribute('data-met', 'false')
  })
})
