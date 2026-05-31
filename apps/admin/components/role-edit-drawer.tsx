'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle,
  Button, ButtonGroup, Input, Label,
} from '@sassy-auth/ui'
import {
  updateRoleAction, getRoleAction, listAppPermissionsAction,
} from '@/app/(admin)/roles/actions'
import { copyToClipboard } from '@/lib/clipboard'
import type { RoleRow, RoleDetail } from '@/lib/types'
import { PermissionRowsEditor, type PermOption } from './role-permission-rows-editor'

interface Props {
  role: RoleRow
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RoleEditDrawer({ role, open, onOpenChange }: Props) {
  const t = useTranslations()
  const [name, setName] = React.useState(role.name)
  const [initialPermIds, setInitialPermIds] = React.useState<string[]>([])
  const [rows, setRows] = React.useState<string[]>([])
  const [perms, setPerms] = React.useState<PermOption[]>([])
  const [loadingDetail, setLoadingDetail] = React.useState(false)
  const [loadingPerms, setLoadingPerms] = React.useState(false)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    setName(role.name)
    setErrorKey(null)
  }, [role])

  // Load existing role detail (permissions) when opening.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingDetail(true)
    getRoleAction(role.publicId).then((res) => {
      if (cancelled) return
      if ('publicId' in res) {
        const ids = (res as RoleDetail).permissions.map((p) => p.publicId)
        setInitialPermIds(ids)
        setRows(ids)
      }
    }).finally(() => { if (!cancelled) setLoadingDetail(false) })
    return () => { cancelled = true }
  }, [open, role.publicId])

  // Load app's available permissions for the dropdown.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingPerms(true)
    listAppPermissionsAction(role.app.publicId).then((res) => {
      if (cancelled) return
      if (Array.isArray(res)) setPerms(res)
      else setPerms([])
    }).finally(() => { if (!cancelled) setLoadingPerms(false) })
    return () => { cancelled = true }
  }, [open, role.app.publicId])

  const currentIds = Array.from(new Set(rows.filter((id) => id !== '')))
  const initialSet = new Set(initialPermIds)
  const currentSet = new Set(currentIds)
  const permsDirty = initialSet.size !== currentSet.size
    || [...currentSet].some((id) => !initialSet.has(id))
  const dirty = name !== role.name || permsDirty

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    if (!name.trim()) { setErrorKey('roles.errors.nameRequired'); return }
    setErrorKey(null)
    const patch: { name?: string; permissionIds?: string[] } = {}
    if (name !== role.name) patch.name = name.trim()
    if (permsDirty) patch.permissionIds = currentIds
    startTransition(async () => {
      const result = await updateRoleAction(role.publicId, patch)
      if ('errorKey' in result) setErrorKey(result.errorKey)
      else onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('roles.drawer.editTitle')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="roleName">{t('roles.fields.name')}</Label>
              <Input
                id="roleName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <p className="mt-1 text-label-sm text-muted-foreground">{t('roles.fields.nameHint')}</p>
            </div>
            <div>
              <Label>{t('roles.fields.app')}</Label>
              <div className="mt-1 flex items-center justify-between rounded border border-border bg-card px-3 py-2">
                <span className="text-body-sm">{role.app.name}</span>
                <code className="font-mono text-label-md text-muted-foreground">{role.app.publicId}</code>
              </div>
              <p className="mt-1 text-label-sm text-muted-foreground">{t('roles.fields.appImmutable')}</p>
            </div>
            <div>
              <Label htmlFor="rolePublicId">{t('roles.fields.publicId')}</Label>
              <div className="flex gap-2">
                <Input id="rolePublicId" value={role.publicId} readOnly className="font-mono" />
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('roles.actions.copy')}
                  onClick={() =>
                    copyToClipboard(role.publicId, () => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    })
                  }
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {copied ? 'check' : 'content_copy'}
                  </span>
                </Button>
              </div>
              {copied && (
                <p className="mt-1 text-label-sm text-primary">{t('roles.actions.copied')}</p>
              )}
            </div>

            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h3 className="mb-3 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">
                {t('roles.fields.permissions')}
              </h3>
              {loadingDetail ? (
                <p className="text-body-sm text-muted-foreground">…</p>
              ) : (
                <PermissionRowsEditor
                  appId={role.app.publicId}
                  perms={perms}
                  rows={rows}
                  onRowsChange={setRows}
                  loading={loadingPerms}
                />
              )}
            </section>

            {errorKey && (
              <p role="alert" className="text-body-sm text-destructive">{t(errorKey)}</p>
            )}
            <div className="flex justify-end pt-4">
              <ButtonGroup>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                  {t('roles.drawer.cancel')}
                </Button>
                <Button type="submit" disabled={!dirty || pending}>
                  {pending ? t('roles.drawer.saving') : t('roles.drawer.save')}
                </Button>
              </ButtonGroup>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
