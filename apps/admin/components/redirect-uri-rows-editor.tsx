'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'
import { Button } from '@sassy-auth/ui'
import type { RedirectUri } from '@/lib/types'

interface Props {
  rows: RedirectUri[]
  onRowsChange: (next: RedirectUri[]) => void
}

export function RedirectUriRowsEditor({ rows, onRowsChange }: Props) {
  const t = useTranslations()
  const loginUris = rows.filter((r) => r.kind === 'login')

  function update(idx: number, patch: Partial<RedirectUri>) {
    const next = rows.slice()
    next[idx] = { ...next[idx], ...patch }
    onRowsChange(next)
  }
  function remove(idx: number) {
    onRowsChange(rows.filter((_, i) => i !== idx))
  }
  function addRow() {
    onRowsChange([...rows, { uri: '', kind: 'login' }])
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((row, idx) => (
          <li key={idx} className="flex items-center gap-2">
            <input
              type="url"
              aria-label={t('apps.fields.redirectUris')}
              value={row.uri}
              onChange={(e) => update(idx, { uri: e.target.value })}
              placeholder={t('apps.fields.redirectUriPlaceholder')}
              className="block h-9 w-full rounded border border-border bg-card px-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <select
              aria-label={t('apps.fields.redirectUriKindLabel')}
              value={row.kind}
              onChange={(e) => update(idx, { kind: e.target.value as RedirectUri['kind'] })}
              className="block h-9 shrink-0 rounded border border-border bg-card px-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="login">{t('apps.fields.redirectUriKindLogin')}</option>
              <option value="post_logout">{t('apps.fields.redirectUriKindPostLogout')}</option>
            </select>
            <button
              type="button"
              aria-label={t('apps.fields.removeRedirectUri')}
              onClick={() => remove(idx)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4" />
        {t('apps.fields.addRedirectUri')}
      </Button>
      {loginUris.length === 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          {t('apps.fields.noLoginUrisWarning')}
        </p>
      )}
    </div>
  )
}
