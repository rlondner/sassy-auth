'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'
import type { ConsentDocumentType } from '@sassy-auth/types'
import type { OutstandingConsentDocument } from '@/lib/consent'
import { acceptConsentAction } from './actions'

const LABEL_KEY: Record<ConsentDocumentType, 'acceptPrivacyPolicy' | 'acceptTerms' | 'acceptGdpr'> = {
  privacy_policy: 'acceptPrivacyPolicy',
  terms: 'acceptTerms',
  gdpr: 'acceptGdpr',
}

export function ConsentGateClient({
  appPublicId,
  next,
  outstanding,
}: {
  appPublicId: string
  next: string
  outstanding: OutstandingConsentDocument[]
}) {
  const t = useTranslations()
  const [checked, setChecked] = React.useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const allChecked = outstanding.every((doc) => checked[doc.documentType])

  async function handleContinue() {
    setSubmitting(true)
    setError(null)
    try {
      const result = await acceptConsentAction(appPublicId, outstanding.map((d) => d.documentType), next)
      if (result && 'error' in result) {
        setError(t('loginConsent.error'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-md text-muted-foreground">{t('loginConsent.body')}</p>
      {outstanding.map((doc) => (
        <label key={doc.documentType} className="flex items-start gap-2 text-body-sm text-foreground">
          <input
            type="checkbox"
            checked={checked[doc.documentType] ?? false}
            onChange={(e) => setChecked((prev) => ({ ...prev, [doc.documentType]: e.target.checked }))}
          />
          <span>
            {t.rich(`signup.${LABEL_KEY[doc.documentType]}`, {
              link: (chunks) => (
                <a href={doc.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      ))}
      {error && <p className="text-label-md text-destructive">{error}</p>}
      <Button className="w-full" loading={submitting} disabled={submitting || !allChecked} onClick={handleContinue}>
        {t('loginConsent.continue')}
      </Button>
    </div>
  )
}
