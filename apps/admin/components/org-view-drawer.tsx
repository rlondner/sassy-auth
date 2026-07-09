'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle, Button, ButtonGroup, Badge } from '@sassy-auth/ui'
import { useCopyFeedback } from '@/lib/use-copy-feedback'
import type { OrgRow } from '@/lib/types'

interface Props {
  org: OrgRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

export function OrgViewDrawer({ org, open, onOpenChange, onEdit, onDelete }: Props) {
  const t = useTranslations()
  const { copiedKey: copied, copy } = useCopyFeedback()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-border bg-muted text-primary">
              <span className="material-symbols-outlined text-[20px]">corporate_fare</span>
            </div>
            <SheetTitle>{org.name}</SheetTitle>
            {org.isPlatform && <Badge variant="secondary">{t('orgs.badges.platform')}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {!org.isPlatform && (
              <ButtonGroup>
                <Button size="sm" variant="outline" onClick={onEdit}>{t('orgs.actions.edit')}</Button>
                <Button size="sm" variant="outline" className="border-destructive text-destructive" onClick={onDelete}>
                  {t('orgs.actions.delete')}
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
            label={t('orgs.fields.app')}
            value={org.app.name}
            onCopy={() => copy(org.app.publicId, 'app')}
            copied={copied === 'app'}
            copyLabel={t('orgs.actions.copy')}
          />
          <DetailRow
            label={t('orgs.fields.publicId')}
            value={org.publicId}
            mono
            onCopy={() => copy(org.publicId, 'sqid')}
            copied={copied === 'sqid'}
            copyLabel={t('orgs.actions.copy')}
          />
          <div>
            <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('orgs.fields.users')}</p>
            <div className="mt-1 flex items-center justify-between rounded border border-border bg-card px-3 py-2">
              <span className="text-body-sm">{t('orgs.fields.userCount', { count: org.userCount })}</span>
              <Link href={`/users?orgId=${org.publicId}`} className="text-body-sm text-primary hover:underline">
                {t('orgs.fields.viewUsers')}
              </Link>
            </div>
          </div>
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
