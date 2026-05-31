'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Button,
  ButtonGroup,
  Input,
  Label,
} from '@sassy-auth/ui'
import { updateAppAction } from '@/app/(admin)/apps/actions'
import { copyToClipboard } from '@/lib/clipboard'
import type { App } from '@/lib/types'

interface Props {
  app: App
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AppEditDrawer({ app, open, onOpenChange }: Props) {
  const t = useTranslations()
  const [name, setName] = React.useState(app.name)
  const [url, setUrl] = React.useState(app.url)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    setName(app.name)
    setUrl(app.url)
    setErrorKey(null)
  }, [app])

  const dirty = name !== app.name || url !== app.url

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    const patch: { name?: string; url?: string } = {}
    if (name !== app.name) patch.name = name.trim()
    if (url !== app.url) patch.url = url.trim()
    startTransition(async () => {
      const result = await updateAppAction(app.publicId, patch)
      if ('errorKey' in result) setErrorKey(result.errorKey)
      else onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('apps.drawer.editTitle')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="appName">{t('apps.fields.name')}</Label>
              <Input
                id="appName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="appUrl">{t('apps.fields.url')}</Label>
              <Input
                id="appUrl"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="appPublicId">{t('apps.fields.publicId')}</Label>
              <div className="flex gap-2">
                <Input
                  id="appPublicId"
                  value={app.publicId}
                  readOnly
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('apps.actions.copy')}
                  onClick={() =>
                    copyToClipboard(app.publicId, () => {
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
                  {t('apps.actions.copied')}
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
                  {t('apps.drawer.cancel')}
                </Button>
                <Button type="submit" disabled={!dirty || pending}>
                  {pending ? t('apps.drawer.saving') : t('apps.drawer.save')}
                </Button>
              </ButtonGroup>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
