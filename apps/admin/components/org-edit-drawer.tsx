'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle,
  Button, ButtonGroup, Input, Label,
} from '@sassy-auth/ui'
import { updateOrgAction } from '@/app/(admin)/orgs/actions'
import { copyToClipboard } from '@/lib/clipboard'
import type { OrgRow } from '@/lib/types'

interface Props {
  org: OrgRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function OrgEditDrawer({ org, open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations()
  const [name, setName] = React.useState(org.name)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    setName(org.name)
    setErrorKey(null)
  }, [org])

  const dirty = name !== org.name

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    startTransition(async () => {
      const result = await updateOrgAction(org.publicId, { name: name.trim() })
      if ('errorKey' in result) {
        setErrorKey(result.errorKey)
        return
      }
      toast.success(t('orgs.toast.updated'))
      onSuccess?.()
      onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('orgs.drawer.editTitle')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="orgName">{t('orgs.fields.name')}</Label>
              <Input
                id="orgName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>{t('orgs.fields.app')}</Label>
              <div className="mt-1 flex items-center justify-between rounded border border-border bg-card px-3 py-2">
                <span className="text-body-sm">{org.app.name}</span>
                <code className="font-mono text-label-md text-muted-foreground">{org.app.publicId}</code>
              </div>
              <p className="mt-1 text-label-sm text-muted-foreground">{t('orgs.fields.appReadOnlyHint')}</p>
            </div>
            <div>
              <Label htmlFor="orgPublicId">{t('orgs.fields.publicId')}</Label>
              <div className="flex gap-2">
                <Input
                  id="orgPublicId"
                  value={org.publicId}
                  readOnly
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('orgs.actions.copy')}
                  onClick={() =>
                    copyToClipboard(org.publicId, () => {
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
                <p className="mt-1 text-label-sm text-primary">
                  {t('orgs.actions.copied')}
                </p>
              )}
            </div>
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
                  disabled={pending}
                >
                  {t('orgs.drawer.cancel')}
                </Button>
                <Button type="submit" disabled={!dirty || pending}>
                  {pending ? t('orgs.drawer.saving') : t('orgs.drawer.save')}
                </Button>
              </ButtonGroup>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
