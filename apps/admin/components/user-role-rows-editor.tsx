'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'
import { Button } from '@sassy-auth/ui'

export interface RoleOption { publicId: string; name: string }

interface Props {
  appId: string
  roles: RoleOption[]
  rows: string[]
  onRowsChange: (next: string[]) => void
  loading: boolean
}

export function RoleRowsEditor({ appId, roles, rows, onRowsChange, loading }: Props) {
  const t = useTranslations()

  if (!appId) {
    return <p className="text-body-sm text-muted-foreground">{t('users.fields.selectOrgFirst')}</p>
  }
  if (loading) {
    return <p className="text-body-sm text-muted-foreground">…</p>
  }
  if (roles.length === 0) {
    return <p className="text-body-sm text-muted-foreground">{t('users.fields.noRolesForApp')}</p>
  }

  function update(idx: number, value: string) {
    const next = rows.slice()
    next[idx] = value
    onRowsChange(next)
  }
  function remove(idx: number) {
    onRowsChange(rows.filter((_, i) => i !== idx))
  }
  function addRow() {
    onRowsChange([...rows, ''])
  }
  function isTakenElsewhere(thisIdx: number, candidate: string): boolean {
    return rows.some((v, i) => i !== thisIdx && v !== '' && v === candidate)
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-label-sm text-muted-foreground">{t('users.drawer.noRoles')}</p>
      )}
      <ul className="space-y-2">
        {rows.map((value, idx) => (
          <li key={idx} className="flex items-center gap-2">
            <select
              aria-label={t('users.fields.roleRow')}
              value={value}
              onChange={(e) => update(idx, e.target.value)}
              className="block h-9 w-full rounded border border-border bg-card px-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="" disabled>{t('users.fields.selectRole')}</option>
              {roles.map((r) => (
                <option
                  key={r.publicId}
                  value={r.publicId}
                  disabled={isTakenElsewhere(idx, r.publicId)}
                >
                  {r.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={t('users.fields.removeRole')}
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
        {t('users.fields.addRole')}
      </Button>
    </div>
  )
}
