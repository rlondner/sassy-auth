'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle, Button, ButtonGroup, Badge } from '@sassy-auth/ui'
import { useCopyFeedback } from '@/lib/use-copy-feedback'
import type { App, RedirectUri } from '@/lib/types'

interface Props {
  app: App
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

export function AppViewDrawer({ app, open, onOpenChange, onEdit, onDelete }: Props) {
  const t = useTranslations()
  const { copiedKey: copied, copy } = useCopyFeedback()

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
          <RedirectUriGroup
            label={t('apps.fields.loginRedirectUris')}
            uris={(app.redirectUris ?? []).filter((r) => r.kind === 'login')}
            copy={copy}
            copied={copied}
            copyLabel={t('apps.actions.copy')}
            emptyLabel={t('apps.fields.noRedirectUris')}
          />
          <RedirectUriGroup
            label={t('apps.fields.postLogoutRedirectUris')}
            uris={(app.redirectUris ?? []).filter((r) => r.kind === 'post_logout')}
            copy={copy}
            copied={copied}
            copyLabel={t('apps.actions.copy')}
            emptyLabel={t('apps.fields.noRedirectUris')}
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

function RedirectUriGroup({
  label, uris, copy, copied, copyLabel, emptyLabel,
}: {
  label: string
  uris: RedirectUri[]
  copy: (text: string, key: string) => void
  copied: string | null
  copyLabel: string
  emptyLabel: string
}) {
  return (
    <div>
      <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      {uris.length === 0 ? (
        <div className="mt-1 rounded border border-border bg-card px-3 py-2">
          <span className="text-body-sm text-muted-foreground">{emptyLabel}</span>
        </div>
      ) : (
        <div className="mt-1 space-y-1">
          {uris.map((r, idx) => {
            const key = `${label}-${idx}`
            return (
              <div key={key} className="flex items-center justify-between rounded border border-border bg-card px-3 py-2">
                <code className="text-body-sm">{r.uri}</code>
                <button type="button" aria-label={copyLabel} onClick={() => copy(r.uri, key)} className="text-muted-foreground hover:text-primary">
                  <span className="material-symbols-outlined text-[16px]">{copied === key ? 'check' : 'content_copy'}</span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
