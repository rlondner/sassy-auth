'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import type { PasswordPolicy } from '@/lib/types'

interface Props {
  password: string
  policy: PasswordPolicy
}

export function PasswordRequirementsChecklist({ password, policy }: Props) {
  const t = useTranslations()
  const results = evaluatePasswordPolicy(password, policy)

  return (
    <ul className="mt-2 space-y-1">
      {results.map(({ rule, met }) => {
        const count = rule === 'minLength' ? policy.minLength
          : rule === 'minNumbers' ? policy.minNumbers
          : rule === 'minSpecial' ? policy.minSpecial
          : undefined
        return (
          <li
            key={rule}
            data-testid={`rule-${rule}`}
            data-met={met}
            className={`flex items-center gap-1.5 text-body-sm ${met ? 'text-[var(--primary)]' : 'text-muted-foreground'}`}
          >
            <span className="material-symbols-outlined text-[16px]" style={met ? { fontVariationSettings: "'FILL' 1" } : undefined}>
              {met ? 'check_circle' : 'radio_button_unchecked'}
            </span>
            {count !== undefined
              ? t(`password.rules.${rule}` as 'password.rules.minLength', { count })
              : t(`password.rules.${rule}` as 'password.rules.requireUppercase')}
          </li>
        )
      })}
    </ul>
  )
}
