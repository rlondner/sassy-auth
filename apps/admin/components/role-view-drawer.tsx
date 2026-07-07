'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { ShieldEllipsis, KeyRound } from 'lucide-react'
import {
  Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle,
  Button, ButtonGroup, Badge,
} from '@sassy-auth/ui'
import { useCopyFeedback } from '@/lib/use-copy-feedback'
import { getRoleAction } from '@/app/(admin)/roles/actions'
import type { RoleRow, RoleDetail } from '@/lib/types'

interface Props {
  role: RoleRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

export function RoleViewDrawer({ role, open, onOpenChange, onEdit, onDelete }: Props) {
  const t = useTranslations()
  const [detail, setDetail] = React.useState<RoleDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const { copiedKey: copied, copy } = useCopyFeedback()

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    setDetail(null)
    getRoleAction(role.publicId)
      .then((res) => { if ('publicId' in res) setDetail(res) })
      .finally(() => setLoading(false))
  }, [open, role.publicId])

  const permissions = detail?.permissions ?? []
  const permissionCount = detail?.permissionCount ?? role.permissionCount
  const userCount = detail?.userCount ?? role.userCount

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-border bg-muted text-primary">
              <ShieldEllipsis className="h-5 w-5" />
            </div>
            <SheetTitle>{role.name}</SheetTitle>
          </div>
          <div className="flex items-center gap-2">
            <ButtonGroup>
              <Button size="sm" variant="outline" onClick={onEdit}>{t('roles.actions.edit')}</Button>
              <Button
                size="sm" variant="outline"
                className="border-destructive text-destructive"
                onClick={onDelete}
                disabled={userCount > 0}
                title={userCount > 0 ? t('roles.drawer.inUseTooltip', { userCount }) : undefined}
              >
                {t('roles.actions.delete')}
              </Button>
            </ButtonGroup>
            <SheetClose asChild>
              <button className="ml-2 flex h-7 w-7 items-center justify-center rounded hover:bg-muted">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </SheetClose>
          </div>
        </SheetHeader>
        <SheetBody className="space-y-6">
          <DetailRow
            label={t('roles.fields.app')}
            value={role.app.name}
            onCopy={() => copy(role.app.publicId, 'app')}
            copied={copied === 'app'}
            copyLabel={t('roles.actions.copy')}
          />
          <DetailRow
            label={t('roles.fields.publicId')}
            value={role.publicId}
            mono
            onCopy={() => copy(role.publicId, 'sqid')}
            copied={copied === 'sqid'}
            copyLabel={t('roles.actions.copy')}
          />

          <section className="rounded-xl border border-border bg-card shadow-sm p-6">
            <header className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">
                <KeyRound className="h-4 w-4" />
                {t('roles.drawer.permissionsSection')}
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{permissionCount}</span>
              </h3>
              {permissionCount > 50 && (
                <span className="text-label-sm text-muted-foreground">{t('roles.drawer.showingTop50', { total: permissionCount })}</span>
              )}
            </header>
            {loading ? (
              <p className="text-body-sm text-muted-foreground">…</p>
            ) : permissions.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">{t('roles.drawer.noPermissions')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {permissions.map((p) => (
                  <Badge key={p.publicId} variant="secondary"><span className="font-mono">{p.name}</span></Badge>
                ))}
              </div>
            )}
          </section>

          <p className="text-label-sm text-muted-foreground">
            {userCount} {t('roles.fields.usersShort')} · {permissionCount} {t('roles.fields.permissionsShort')}
          </p>
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
