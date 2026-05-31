'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle, Button, ButtonGroup, Badge } from '@sassy-auth/ui'
import { copyToClipboard } from '@/lib/clipboard'
import type { App } from '@/lib/types'

interface Props {
  app: App
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

export function AppViewDrawer({ app, open, onOpenChange, onEdit, onDelete }: Props) {
  const t = useTranslations()
  const [copied, setCopied] = React.useState<string | null>(null)

  function copy(text: string, key: string) {
    copyToClipboard(text, () => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-border bg-muted text-primary">
              <span className="material-symbols-outlined text-[20px]">apps</span>
            </div>
            <SheetTitle>{app.name}</SheetTitle>
            {app.isPlatform && <Badge variant="secondary">{t('apps.badges.platform')}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {!app.isPlatform && (
              <ButtonGroup>
                <Button size="sm" variant="outline" onClick={onEdit}>{t('apps.actions.edit')}</Button>
                <Button size="sm" variant="outline" className="border-destructive text-destructive" onClick={onDelete}>
                  {t('apps.actions.delete')}
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
            label={t('apps.fields.url')}
            value={app.url}
            onCopy={() => copy(app.url, 'url')}
            copied={copied === 'url'}
            copyLabel={t('apps.actions.copy')}
          />
          <DetailRow
            label={t('apps.fields.publicId')}
            value={app.publicId}
            mono
            onCopy={() => copy(app.publicId, 'sqid')}
            copied={copied === 'sqid'}
            copyLabel={t('apps.actions.copy')}
          />
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
