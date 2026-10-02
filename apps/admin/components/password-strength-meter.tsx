'use client'

import { useTranslations } from 'next-intl'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import type { PasswordPolicy } from '@/lib/types'

const LEVEL_KEYS = ['weak', 'fair', 'good', 'strong', 'veryStrong'] as const

/**
 * Purely presentational 5-segment bar driven by the same evaluatePasswordPolicy
 * results PasswordRequirementsChecklist already computes — no new password-policy
 * logic. Segments lit = fraction of this policy's own rules currently met,
 * so an app with requireSpecial off never shows a permanently-unlit segment
 * for a rule it doesn't enforce.
 */
export function PasswordStrengthMeter({ password, policy }: { password: string; policy: PasswordPolicy }) {
  const t = useTranslations('signup.passwordStrength')
  const results = evaluatePasswordPolicy(password, policy)
  const met = results.filter((r) => r.met).length
  const segments = password.length === 0 ? 0 : Math.max(1, Math.round((met / results.length) * 5))
  const levelIndex = Math.min(LEVEL_KEYS.length - 1, Math.max(0, segments - 1))

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            data-testid={`strength-segment-${i}`}
            className={`h-1 flex-1 rounded ${i < segments ? 'bg-[var(--primary)]' : 'bg-muted'}`}
          />
        ))}
      </div>
      {password.length > 0 && <p className="text-body-sm text-muted-foreground">{t(LEVEL_KEYS[levelIndex])}</p>}
    </div>
  )
}
