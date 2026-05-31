'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { KeyRound, ShieldEllipsis, Users } from 'lucide-react'
import {
  Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle,
  Button, ButtonGroup, Badge, UserAvatar,
} from '@sassy-auth/ui'
import { copyToClipboard } from '@/lib/clipboard'
import { getPermissionAction } from '@/app/(admin)/permissions/actions'
import type { PermissionRow, PermissionDetail } from '@/lib/types'

interface Props {
  permission: PermissionRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

export function PermissionViewDrawer({ permission, open, onOpenChange, onEdit, onDelete }: Props) {
  const t = useTranslations()
  const [detail, setDetail] = React.useState<PermissionDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [copied, setCopied] = React.useState<string | null>(null)

  const isPlatform = permission.name.startsWith('platform.')

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    setDetail(null)
    getPermissionAction(permission.publicId)
      .then((res) => { if ('publicId' in res) setDetail(res) })
      .finally(() => setLoading(false))
  }, [open, permission.publicId])

  function copy(text: string, key: string) {
    copyToClipboard(text, () => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const roles = detail?.roles ?? []
  const users = detail?.users ?? []
  const roleCount = detail?.roleCount ?? permission.roleCount
  const userCount = detail?.userCount ?? permission.userCount

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-border bg-muted text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <SheetTitle className="font-mono">{permission.name}</SheetTitle>
            {isPlatform && <Badge variant="secondary">{t('permissions.badges.platform')}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {!isPlatform && (
              <ButtonGroup>
                <Button size="sm" variant="outline" onClick={onEdit}>{t('permissions.actions.edit')}</Button>
                <Button
                  size="sm" variant="outline"
                  className="border-destructive text-destructive"
                  onClick={onDelete}
                  disabled={roleCount + userCount > 0}
                  title={roleCount + userCount > 0 ? t('permissions.drawer.inUseTooltip', { roleCount, userCount }) : undefined}
                >
                  {t('permissions.actions.delete')}
                </Button>
              </ButtonGroup>
            )}
            <SheetClose asChild>
              <button className="ml-2 flex h-7 w-7 items-center justify-center rounded hover:bg-muted">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </SheetClose>
          </div>
        </SheetHeader>
        <SheetBody className="space-y-6">
          <DetailRow
            label={t('permissions.fields.app')}
            value={permission.app.name}
            onCopy={() => copy(permission.app.publicId, 'app')}
            copied={copied === 'app'}
            copyLabel={t('permissions.actions.copy')}
          />
          <DetailRow
            label={t('permissions.fields.publicId')}
            value={permission.publicId}
            mono
            onCopy={() => copy(permission.publicId, 'sqid')}
            copied={copied === 'sqid'}
            copyLabel={t('permissions.actions.copy')}
          />

          {/* Roles section */}
          <section className="rounded-xl border border-border bg-card shadow-sm p-6">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">
                <ShieldEllipsis className="h-4 w-4" />
                {t('permissions.drawer.rolesSection')}
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{roleCount}</span>
              </h3>
              {roleCount > 50 && (
                <span className="text-label-sm text-muted-foreground">{t('permissions.drawer.showingTop50', { total: roleCount })}</span>
              )}
            </header>
            {loading ? (
              <p className="text-body-sm text-muted-foreground">…</p>
            ) : roles.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">{t('permissions.drawer.noRoles')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => (
                  <Badge key={r.publicId} variant="secondary" title={r.appName}>{r.name}</Badge>
                ))}
              </div>
            )}
          </section>

          {/* Users section */}
          <section className="rounded-xl border border-border bg-card shadow-sm p-6">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">
                <Users className="h-4 w-4" />
                {t('permissions.drawer.usersSection')}
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{userCount}</span>
              </h3>
              {userCount > 50 && (
                <span className="text-label-sm text-muted-foreground">{t('permissions.drawer.showingTop50', { total: userCount })}</span>
              )}
            </header>
            {loading ? (
              <p className="text-body-sm text-muted-foreground">…</p>
            ) : users.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">{t('permissions.drawer.noUsers')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {users.map((u) => (
                  <li key={u.publicId} className="flex items-center gap-3 py-2">
                    <UserAvatar firstName={u.firstName} lastName={u.lastName} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-medium text-foreground">{u.firstName} {u.lastName}</p>
                      <p className="truncate text-label-sm text-muted-foreground">{u.email}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function DetailRow({
  label, value, onCopy, copied, mono, copyLabel,
}: { label: string; value: string; onCopy: () => void; copied: boolean; mono?: boolean; copyLabel: string }) {
  return (
    <div>
      <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center justify-between rounded border border-border bg-card px-3 py-2">
        <code className={mono ? 'font-mono text-body-sm' : 'text-body-sm'}>{value}</code>
        <button type="button" aria-label={copyLabel} onClick={onCopy} className="text-muted-foreground hover:text-primary">
          <span className="material-symbols-outlined text-[16px]">{copied ? 'check' : 'content_copy'}</span>
        </button>
      </div>
    </div>
  )
}
