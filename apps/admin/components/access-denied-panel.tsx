'use client'

import { useTranslations } from 'next-intl'

export function AccessDeniedPanel() {
  const t = useTranslations()
  return (
    <div className="flex h-full items-center justify-center p-container-padding">
      <div className="max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <span className="material-symbols-outlined mx-auto block text-[36px] text-muted-foreground">lock</span>
        <h2 className="mt-3 text-headline-sm">{t('apps.accessDenied.title')}</h2>
        <p className="mt-2 text-body-sm text-muted-foreground">{t('apps.accessDenied.body')}</p>
      </div>
    </div>
  )
}
