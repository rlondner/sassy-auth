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
import { updateAppAction, getSocialProviderSettingsAction, updateSocialProvidersAction } from '@/app/(admin)/apps/actions'
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

  // The checkbox universe is `available` — every provider this deployment
  // has credentials for, from GET /api/social-providers/:clientId/settings
  // — not just the ones currently on for this app, so a provider that's
  // off can be ticked back on. `checkedProviders` is the live checkbox
  // state; `initialProviders` is the fetched `enabled` baseline used to
  // detect a change, kept separate so `dirty` can compare the two.
  const [availableProviders, setAvailableProviders] = React.useState<string[]>([])
  const [checkedProviders, setCheckedProviders] = React.useState<Set<string>>(new Set())
  const [initialProviders, setInitialProviders] = React.useState<string[]>([])
  const [socialLoading, setSocialLoading] = React.useState(false)

  React.useEffect(() => {
    setName(app.name)
    setUrl(app.url)
    setCallbackUrl(app.callbackUrl ?? '')
    setTwoFactorTrustDays(app.twoFactorTrustDays ?? null)
    setRequireTwoFactor(app.requireTwoFactor ?? false)
    setErrorKey(null)
    // Gate the authenticated social-providers fetch on the drawer actually
    // being open: AppsTable keeps this component mounted (with `open`
    // toggling) for every selected row, including View and Delete, so an
    // unconditional fetch here fired on every row click for a result that
    // was never shown. Skipping while closed also means an app switch that
    // happens while the drawer is closed doesn't fetch until it opens.
    if (!open) return
    setSocialLoading(true)
    let cancelled = false
    getSocialProviderSettingsAction(app.publicId).then((result) => {
      if (cancelled) return
      const { available, enabled } = 'available' in result ? result : { available: [], enabled: [] }
      setAvailableProviders(available)
      setCheckedProviders(new Set(enabled))
      setInitialProviders(enabled)
      setSocialLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [app, open])

  function toggleProvider(provider: string, checked: boolean) {
    setCheckedProviders((prev) => {
      const next = new Set(prev)
      if (checked) next.add(provider)
      else next.delete(provider)
      return next
    })
  }

  const socialDirty =
    checkedProviders.size !== initialProviders.length ||
    initialProviders.some((p) => !checkedProviders.has(p))

  const dirty = name !== app.name || url !== app.url || callbackUrl !== (app.callbackUrl ?? '') || twoFactorTrustDays !== (app.twoFactorTrustDays ?? null) || requireTwoFactor !== (app.requireTwoFactor ?? false) || socialDirty

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty) return
    // bug-0141: a submit with whitespace-only fields is a validation
    // failure at the client layer. Server would reject with a 400
    // and a generic errorKey, but the UX is cleaner if we flag it
    // here — an empty trimmed name means "no name," not "clear name."
    if (name.trim() === '' || url.trim() === '') {
      setErrorKey('apps.errors.nameRequired')
      return
    }
    const patch: { name?: string; url?: string; callbackUrl?: string | null; twoFactorTrustDays?: number | null; requireTwoFactor?: boolean } = {}
    if (name !== app.name) patch.name = name.trim()
    if (url !== app.url) patch.url = url.trim()
    if (callbackUrl !== (app.callbackUrl ?? '')) patch.callbackUrl = callbackUrl.trim() || null
    if (twoFactorTrustDays !== (app.twoFactorTrustDays ?? null)) patch.twoFactorTrustDays = twoFactorTrustDays
    if (requireTwoFactor !== (app.requireTwoFactor ?? false)) patch.requireTwoFactor = requireTwoFactor
    startTransition(async () => {
      // Two independent endpoints: /api/apps for the core fields, and
      // /api/social-providers/:clientId for the checkbox group — the
      // button saves both if both changed.
      if (Object.keys(patch).length > 0) {
        const result = await updateAppAction(app.publicId, patch)
        if ('errorKey' in result) {
          setErrorKey(result.errorKey)
          return
        }
      }
      if (socialDirty) {
        const result = await updateSocialProvidersAction(app.publicId, Array.from(checkedProviders))
        if ('errorKey' in result) {
          setErrorKey(result.errorKey)
          return
        }
        setInitialProviders(result.providers)
        setCheckedProviders(new Set(result.providers))
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
              <Label>{t('apps.fields.socialProviders')}</Label>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.socialProvidersHint')}
              </p>
              {!socialLoading && availableProviders.length > 0 && (
                <div className="mt-2 space-y-2">
                  {availableProviders.map((provider) => (
                    <label
                      key={provider}
                      className="flex items-center gap-2 text-label-md cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checkedProviders.has(provider)}
                        onChange={(e) => toggleProvider(provider, e.target.checked)}
                        className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                      />
                      {t.has(`apps.fields.socialProviderNames.${provider}`)
                        ? t(`apps.fields.socialProviderNames.${provider}` as 'apps.fields.socialProviderNames.google')
                        : provider}
                    </label>
                  ))}
                </div>
              )}
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
