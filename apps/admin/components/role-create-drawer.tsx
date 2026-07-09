'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle,
  Button, ButtonGroup, Input, Label,
} from '@sassy-auth/ui'
import { createRoleAction, listAppPermissionsAction } from '@/app/(admin)/roles/actions'
import type { App } from '@/lib/types'
import { PermissionRowsEditor, type PermOption } from './role-permission-rows-editor'

interface Props {
  apps: App[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function RoleCreateDrawer({ apps, open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations()
  const [name, setName] = React.useState('')
  const [appId, setAppId] = React.useState('')
  const [perms, setPerms] = React.useState<PermOption[]>([])
  const [rows, setRows] = React.useState<string[]>([])
  const [permsLoading, setPermsLoading] = React.useState(false)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open) {
      setName('')
      setAppId('')
      setPerms([])
      setRows([])
      setErrorKey(null)
    }
  }, [open])

  // Load app's permissions whenever the app changes.
  React.useEffect(() => {
    if (!appId) { setPerms([]); setRows([]); return }
    let cancelled = false
    setPermsLoading(true)
    listAppPermissionsAction(appId).then((res) => {
      if (cancelled) return
      if (Array.isArray(res)) setPerms(res)
      else setPerms([])
      setRows([])
    }).finally(() => { if (!cancelled) setPermsLoading(false) })
    return () => { cancelled = true }
  }, [appId])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!appId) { setErrorKey('roles.errors.appRequired'); return }
    if (!name.trim()) { setErrorKey('roles.errors.nameRequired'); return }
    setErrorKey(null)
    const permissionIds = rows.filter((id) => id !== '')
    const uniqIds = Array.from(new Set(permissionIds))
    startTransition(async () => {
      const result = await createRoleAction({ name: name.trim(), appId, permissionIds: uniqIds })
      if ('errorKey' in result) {
        setErrorKey(result.errorKey)
        return
      }
      toast.success(t('roles.toast.created'))
      onSuccess?.()
      onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>{t('roles.drawer.createTitle')}</SheetTitle>
            <SheetDescription>{t('roles.drawer.createSubtitle')}</SheetDescription>
          </div>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="roleApp">{t('roles.fields.app')}</Label>
              <select
                id="roleApp"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                required
                className="mt-1 block h-9 w-full rounded border border-border bg-card px-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="" disabled>—</option>
                {apps.map((a) => (
                  <option key={a.publicId} value={a.publicId}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="roleName">{t('roles.fields.name')}</Label>
              <Input
                id="roleName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Editor"
              />
              <p className="mt-1 text-label-sm text-muted-foreground">{t('roles.fields.nameHint')}</p>
            </div>

            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h3 className="mb-3 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">
                {t('roles.fields.permissions')}
              </h3>
              <PermissionRowsEditor
                appId={appId}
                perms={perms}
                rows={rows}
                onRowsChange={setRows}
                loading={permsLoading}
              />
            </section>

            {errorKey && (
              <p role="alert" className="text-body-sm text-destructive">
                {t(errorKey)}
              </p>
            )}
            <div className="flex justify-end pt-4">
              <ButtonGroup>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  loading={pending}
                >
                  {t('roles.drawer.cancel')}
                </Button>
                <Button type="submit" loading={pending}>
                  {t('roles.drawer.createTitle')}
                </Button>
              </ButtonGroup>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
