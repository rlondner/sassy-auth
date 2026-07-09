'use client'

import { Lock } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function AccessDeniedPanel() {
  const t = useTranslations()
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <Lock className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold text-foreground">{t('apps.accessDenied.title')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('apps.accessDenied.body')}</p>
      </div>
    </div>
  )
}
