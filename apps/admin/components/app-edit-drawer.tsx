'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
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
import { useCopyFeedback } from '@/lib/use-copy-feedback'
import type { App } from '@/lib/types'

interface Props {
  app: App
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function AppEditDrawer({ app, open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations()
  const [name, setName] = React.useState(app.name)
  const [url, setUrl] = React.useState(app.url)
  const [callbackUrl, setCallbackUrl] = React.useState(app.callbackUrl ?? '')
  const [twoFactorTrustDays, setTwoFactorTrustDays] = React.useState<number | null>(app.twoFactorTrustDays ?? null)
  const [requireTwoFactor, setRequireTwoFactor] = React.useState<boolean>(app.requireTwoFactor ?? false)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const { copiedKey, copy } = useCopyFeedback()
  const copied = copiedKey !== null
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    setName(app.name)
    setUrl(app.url)
    setCallbackUrl(app.callbackUrl ?? '')
    setTwoFactorTrustDays(app.twoFactorTrustDays ?? null)
    setRequireTwoFactor(app.requireTwoFactor ?? false)
    setErrorKey(null)
  }, [app])

  const dirty = name !== app.name || url !== app.url || callbackUrl !== (app.callbackUrl ?? '') || twoFactorTrustDays !== (app.twoFactorTrustDays ?? null) || requireTwoFactor !== (app.requireTwoFactor ?? false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    // bug-0141: a submit with whitespace-only fields is a validation
    // failure at the client layer. Server would reject with a 400
    // and a generic errorKey, but the UX is cleaner if we flag it
    // here — an empty trimmed name means "no name," not "clear name."
    if (name.trim() === '') {
      setErrorKey('apps.errors.nameRequired')
      return
    }
    if (url.trim() === '') {
      setErrorKey('apps.errors.urlRequired')
      return
    }
    const patch: { name?: string; url?: string; callbackUrl?: string | null; twoFactorTrustDays?: number | null; requireTwoFactor?: boolean } = {}
    if (name !== app.name) patch.name = name.trim()
    if (url !== app.url) patch.url = url.trim()
    if (callbackUrl !== (app.callbackUrl ?? '')) patch.callbackUrl = callbackUrl.trim() || null
    if (twoFactorTrustDays !== (app.twoFactorTrustDays ?? null)) patch.twoFactorTrustDays = twoFactorTrustDays
    if (requireTwoFactor !== (app.requireTwoFactor ?? false)) patch.requireTwoFactor = requireTwoFactor
    startTransition(async () => {
      const result = await updateAppAction(app.publicId, patch)
      if ('errorKey' in result) {
        setErrorKey(result.errorKey)
        return
      }
      toast.success(t('apps.toast.updated'))
      onSuccess?.()
      onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('apps.drawer.editTitle')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
              <Label htmlFor="appCallbackUrl">{t('apps.fields.callbackUrl')}</Label>
              <Input
                id="appCallbackUrl"
                type="url"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="https://app.example.com/auth/callback"
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.callbackUrlHint')}
              </p>
            </div>
            <div>
              <Label htmlFor="appTrustDays">{t('apps.fields.twoFactorTrustDays')}</Label>
              <Input
                id="appTrustDays"
                type="number"
                min={1}
                max={3650}
                value={twoFactorTrustDays ?? ''}
                onChange={(e) =>
                  setTwoFactorTrustDays(e.target.value === '' ? null : Number(e.target.value))
                }
                placeholder={t('apps.fields.twoFactorTrustDaysPlaceholder')}
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.twoFactorTrustDaysHint')}
              </p>
            </div>
            <div>
              <label className="flex items-center gap-2 text-label-md cursor-pointer">
                <input
                  type="checkbox"
                  id="requireTwoFactor"
                  checked={requireTwoFactor}
                  onChange={(e) => setRequireTwoFactor(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                />
                {t('apps.fields.requireTwoFactor')}
              </label>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.requireTwoFactorHint')}
              </p>
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
                    void copy(app.publicId, 'publicId')
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
                  loading={pending}
                >
                  {t('apps.drawer.cancel')}
                </Button>
                <Button type="submit" disabled={!dirty || pending}>
                  {t('apps.drawer.save')}
                </Button>
              </ButtonGroup>
            </div>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
