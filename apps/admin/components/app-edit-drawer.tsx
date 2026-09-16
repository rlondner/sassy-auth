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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sassy-auth/ui'
import { updateAppAction, getAppAction, getSocialProviderSettingsAction, updateSocialProvidersAction, rotateClientSecretAction, rotateWebhookSecretAction } from '@/app/(admin)/apps/actions'
import { listOrgsAction } from '@/app/(admin)/orgs/actions'
import { listRolesAction } from '@/app/(admin)/roles/actions'
import { useCopyFeedback } from '@/lib/use-copy-feedback'
import type { App, RedirectUri, OrgRow, RoleRow, PasswordPolicy } from '@/lib/types'
import { RedirectUriRowsEditor } from './redirect-uri-rows-editor'
import { AppLogoField } from './app-logo-field'

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
  const [logo, setLogo] = React.useState<string | null>(app.logo ?? null)
  // Baseline used by `dirty`/patch-building below. `app.logo` is always null
  // now (GET /api/apps strips it — Finding 2), so it can't be used as the
  // "unchanged" reference once the real value comes back from getAppAction;
  // this tracks that real value instead, same pattern as `initialProviders`
  // for the social-provider checkboxes.
  const [originalLogo, setOriginalLogo] = React.useState<string | null>(app.logo ?? null)
  const [redirectUris, setRedirectUris] = React.useState<RedirectUri[]>(app.redirectUris ?? [])
  const [twoFactorTrustDays, setTwoFactorTrustDays] = React.useState<number | null>(app.twoFactorTrustDays ?? null)
  const [requireTwoFactor, setRequireTwoFactor] = React.useState<boolean>(app.requireTwoFactor ?? false)
  const [defaultOrgId, setDefaultOrgId] = React.useState<string | null>(app.defaultOrgId ?? null)
  const [defaultRoleId, setDefaultRoleId] = React.useState<string | null>(app.defaultRoleId ?? null)
  const [passwordPolicyOverrideEnabled, setPasswordPolicyOverrideEnabled] = React.useState(
    app.passwordPolicyOverride !== null,
  )
  const [passwordPolicy, setPasswordPolicy] = React.useState<PasswordPolicy>(
    app.passwordPolicyOverride ?? app.effectivePasswordPolicy,
  )
  const [webhookUrl, setWebhookUrl] = React.useState<string>(app.webhookUrl ?? '')
  const [hasWebhookSecret, setHasWebhookSecret] = React.useState<boolean>(app.hasWebhookSecret ?? false)
  // Webhook secret rotation: same immediate, separate-from-save pattern as
  // client secret rotation below — the plaintext only ever comes back once,
  // at the moment of generation, and the server requires a webhookUrl to
  // already be saved before it will mint one (see AppsService.rotateWebhookSecret).
  const [newWebhookSecret, setNewWebhookSecret] = React.useState<string | null>(null)
  const [rotatingWebhookSecret, setRotatingWebhookSecret] = React.useState(false)
  const [activationFromName, setActivationFromName] = React.useState<string>(app.activationEmailOverride?.fromName ?? '')
  const [activationFromAddress, setActivationFromAddress] = React.useState<string>(app.activationEmailOverride?.fromAddress ?? '')
  const [activationSubject, setActivationSubject] = React.useState<string>(app.activationEmailOverride?.subject ?? '')
  const [activationMessage, setActivationMessage] = React.useState<string>(app.activationEmailOverride?.message ?? '')
  const [appOrgs, setAppOrgs] = React.useState<OrgRow[]>([])
  const [appRoles, setAppRoles] = React.useState<RoleRow[]>([])
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const { copiedKey, copy } = useCopyFeedback()
  const copied = copiedKey !== null
  const [pending, startTransition] = React.useTransition()

  // Client secret: rotation is a separate, immediate call (not part of the
  // dirty/save flow below) because the plaintext only ever comes back once,
  // at the moment of rotation — there is nothing to "save" afterwards, only
  // to display and let the admin copy.
  const [newClientSecret, setNewClientSecret] = React.useState<string | null>(null)
  const [clientSecretUpdatedAt, setClientSecretUpdatedAt] = React.useState<string | null>(
    app.clientSecretUpdatedAt ?? null,
  )
  const [rotatingSecret, setRotatingSecret] = React.useState(false)

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
    setLogo(app.logo ?? null)
    setOriginalLogo(app.logo ?? null)
    setRedirectUris(app.redirectUris ?? [])
    setTwoFactorTrustDays(app.twoFactorTrustDays ?? null)
    setRequireTwoFactor(app.requireTwoFactor ?? false)
    setDefaultOrgId(app.defaultOrgId ?? null)
    setDefaultRoleId(app.defaultRoleId ?? null)
    setPasswordPolicyOverrideEnabled(app.passwordPolicyOverride !== null)
    setPasswordPolicy(app.passwordPolicyOverride ?? app.effectivePasswordPolicy)
    setWebhookUrl(app.webhookUrl ?? '')
    setHasWebhookSecret(app.hasWebhookSecret ?? false)
    setActivationFromName(app.activationEmailOverride?.fromName ?? '')
    setActivationFromAddress(app.activationEmailOverride?.fromAddress ?? '')
    setActivationSubject(app.activationEmailOverride?.subject ?? '')
    setActivationMessage(app.activationEmailOverride?.message ?? '')
    setErrorKey(null)
    setNewClientSecret(null)
    setNewWebhookSecret(null)
    setClientSecretUpdatedAt(app.clientSecretUpdatedAt ?? null)
    // Gate the authenticated social-providers fetch on the drawer actually
    // being open: AppsTable keeps this component mounted (with `open`
    // toggling) for every selected row, including View and Delete, so an
    // unconditional fetch here fired on every row click for a result that
    // was never shown. Skipping while closed also means an app switch that
    // happens while the drawer is closed doesn't fetch until it opens.
    if (!open) return
    let cancelled = false
    // Finding 2 (final review): GET /api/apps (the list this drawer's `app`
    // prop is sourced from, via AppsTable's `selected` row) no longer sends
    // `logo` — it's stripped to avoid shipping every row's base64 blob on a
    // page load. Fetch the single-app record here, which still includes it,
    // so the logo field is seeded with the real current value rather than
    // always appearing empty.
    getAppAction(app.publicId).then((result) => {
      if (cancelled) return
      if ('app' in result) {
        setLogo(result.app.logo ?? null)
        setOriginalLogo(result.app.logo ?? null)
      }
    })
    setSocialLoading(true)
    getSocialProviderSettingsAction(app.publicId).then((result) => {
      if (cancelled) return
      const { available, enabled } = 'available' in result ? result : { available: [], enabled: [] }
      setAvailableProviders(available)
      setCheckedProviders(new Set(enabled))
      setInitialProviders(enabled)
      setSocialLoading(false)
    })
    Promise.all([
      listOrgsAction({ appId: app.publicId, pageSize: 200 }),
      listRolesAction({ appId: app.publicId, pageSize: 200 }),
    ]).then(([orgsResult, rolesResult]) => {
      if (cancelled) return
      setAppOrgs('items' in orgsResult ? orgsResult.items : [])
      setAppRoles('items' in rolesResult ? rolesResult.items : [])
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

  function handleRotateClientSecret() {
    setRotatingSecret(true)
    startTransition(async () => {
      const result = await rotateClientSecretAction(app.publicId)
      setRotatingSecret(false)
      if ('errorKey' in result) {
        setErrorKey(result.errorKey)
        return
      }
      // Shown exactly once — the server never returns the plaintext again
      // after this response.
      setNewClientSecret(result.clientSecret)
      setClientSecretUpdatedAt(new Date().toISOString())
      toast.success(t('apps.toast.updated'))
    })
  }

  function handleRotateWebhookSecret() {
    setRotatingWebhookSecret(true)
    startTransition(async () => {
      const result = await rotateWebhookSecretAction(app.publicId)
      setRotatingWebhookSecret(false)
      if ('errorKey' in result) {
        setErrorKey(result.errorKey)
        return
      }
      // Shown exactly once — the server never returns the plaintext again
      // after this response.
      setNewWebhookSecret(result.webhookSecret)
      setHasWebhookSecret(true)
      toast.success(t('apps.toast.updated'))
    })
  }

  const socialDirty =
    checkedProviders.size !== initialProviders.length ||
    initialProviders.some((p) => !checkedProviders.has(p))

  const redirectUrisDirty = JSON.stringify(redirectUris) !== JSON.stringify(app.redirectUris ?? [])
  const passwordPolicyDirty =
    passwordPolicyOverrideEnabled !== (app.passwordPolicyOverride !== null)
    || (passwordPolicyOverrideEnabled && JSON.stringify(passwordPolicy) !== JSON.stringify(app.passwordPolicyOverride))
  const webhookUrlDirty = webhookUrl.trim() !== (app.webhookUrl ?? '')
  const activationOverrideBaseline = app.activationEmailOverride ?? { fromName: '', fromAddress: '', subject: '', message: '' }
  const activationDirty =
    activationFromName.trim() !== (activationOverrideBaseline.fromName ?? '') ||
    activationFromAddress.trim() !== (activationOverrideBaseline.fromAddress ?? '') ||
    activationSubject.trim() !== (activationOverrideBaseline.subject ?? '') ||
    activationMessage.trim() !== (activationOverrideBaseline.message ?? '')
  const dirty = name !== app.name || url !== app.url || logo !== originalLogo || redirectUrisDirty || twoFactorTrustDays !== (app.twoFactorTrustDays ?? null) || requireTwoFactor !== (app.requireTwoFactor ?? false) || socialDirty || defaultOrgId !== (app.defaultOrgId ?? null) || defaultRoleId !== (app.defaultRoleId ?? null) || passwordPolicyDirty || webhookUrlDirty || activationDirty

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
    const patch: { name?: string; url?: string; logo?: string | null; redirectUris?: RedirectUri[]; twoFactorTrustDays?: number | null; requireTwoFactor?: boolean; defaultOrgId?: string | null; defaultRoleId?: string | null; passwordPolicyOverride?: PasswordPolicy | null; webhookUrl?: string | null; activationEmailOverride?: import('@/lib/types').ActivationEmailBranding | null } = {}
    if (name !== app.name) patch.name = name.trim()
    if (url !== app.url) patch.url = url.trim()
    if (logo !== originalLogo) patch.logo = logo
    if (redirectUrisDirty) patch.redirectUris = redirectUris
    if (twoFactorTrustDays !== (app.twoFactorTrustDays ?? null)) patch.twoFactorTrustDays = twoFactorTrustDays
    if (requireTwoFactor !== (app.requireTwoFactor ?? false)) patch.requireTwoFactor = requireTwoFactor
    if (defaultOrgId !== (app.defaultOrgId ?? null)) patch.defaultOrgId = defaultOrgId
    if (defaultRoleId !== (app.defaultRoleId ?? null)) patch.defaultRoleId = defaultRoleId
    if (passwordPolicyDirty) {
      patch.passwordPolicyOverride = passwordPolicyOverrideEnabled ? passwordPolicy : null
    }
    if (webhookUrlDirty) {
      const trimmedWebhookUrl = webhookUrl.trim()
      // Clearing the URL cascades server-side to clear any stored secret too
      // — a webhook is never left half-configured (see AppsService.updateApp).
      patch.webhookUrl = trimmedWebhookUrl === '' ? null : trimmedWebhookUrl
    }
    if (activationDirty) {
      const trimmed = {
        fromName: activationFromName.trim(),
        fromAddress: activationFromAddress.trim(),
        subject: activationSubject.trim(),
        message: activationMessage.trim(),
      }
      const allEmpty = Object.values(trimmed).every((v) => v === '')
      patch.activationEmailOverride = allEmpty
        ? null
        : Object.fromEntries(Object.entries(trimmed).filter(([, v]) => v !== '')) as import('@/lib/types').ActivationEmailBranding
    }
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
      <SheetContent size="xl">
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
              <AppLogoField value={logo} onValueChange={setLogo} />
            </div>
            <div>
              <Label>{t('apps.fields.redirectUris')}</Label>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.redirectUrisHint')}
              </p>
              <div className="mt-2">
                <RedirectUriRowsEditor rows={redirectUris} onRowsChange={setRedirectUris} />
              </div>
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
              <Label>{t('apps.fields.passwordPolicy')}</Label>
              <label className="mt-2 flex items-center gap-2 text-label-md cursor-pointer">
                <input
                  type="checkbox"
                  aria-label={t('apps.fields.passwordPolicyOverrideToggle')}
                  checked={passwordPolicyOverrideEnabled}
                  onChange={(e) => setPasswordPolicyOverrideEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                />
                {t('apps.fields.passwordPolicyOverrideToggle')}
              </label>
              {!passwordPolicyOverrideEnabled && (
                <p className="mt-1 text-body-sm text-muted-foreground">
                  {t('apps.fields.passwordPolicyInherited', {
                    summary: `${app.effectivePasswordPolicy.minLength}+ chars`,
                  })}
                </p>
              )}
              {passwordPolicyOverrideEnabled && (
                <div className="mt-3 space-y-3 rounded border border-[var(--border)] p-3">
                  <div>
                    <Label htmlFor="pwMinLength">{t('apps.fields.passwordPolicyMinLength')}</Label>
                    <Input
                      id="pwMinLength"
                      type="number"
                      min={8}
                      max={128}
                      value={passwordPolicy.minLength}
                      onChange={(e) =>
                        setPasswordPolicy((p) => ({
                          ...p,
                          minLength: e.target.value === '' ? p.minLength : Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-label-md cursor-pointer">
                    <input
                      type="checkbox"
                      checked={passwordPolicy.requireUppercase}
                      onChange={(e) => setPasswordPolicy((p) => ({ ...p, requireUppercase: e.target.checked }))}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                    />
                    {t('apps.fields.passwordPolicyRequireUppercase')}
                  </label>
                  <label className="flex items-center gap-2 text-label-md cursor-pointer">
                    <input
                      type="checkbox"
                      checked={passwordPolicy.requireLowercase}
                      onChange={(e) => setPasswordPolicy((p) => ({ ...p, requireLowercase: e.target.checked }))}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                    />
                    {t('apps.fields.passwordPolicyRequireLowercase')}
                  </label>
                  <label className="flex items-center gap-2 text-label-md cursor-pointer">
                    <input
                      type="checkbox"
                      checked={passwordPolicy.requireNumber}
                      onChange={(e) => setPasswordPolicy((p) => ({ ...p, requireNumber: e.target.checked }))}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                    />
                    {t('apps.fields.passwordPolicyRequireNumber')}
                  </label>
                  <div>
                    <Label htmlFor="pwMinNumbers">{t('apps.fields.passwordPolicyMinNumbers')}</Label>
                    <Input
                      id="pwMinNumbers"
                      type="number"
                      min={0}
                      max={passwordPolicy.minLength}
                      disabled={!passwordPolicy.requireNumber}
                      value={passwordPolicy.minNumbers}
                      onChange={(e) =>
                        setPasswordPolicy((p) => ({
                          ...p,
                          minNumbers: e.target.value === '' ? p.minNumbers : Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-label-md cursor-pointer">
                    <input
                      type="checkbox"
                      checked={passwordPolicy.requireSpecial}
                      onChange={(e) => setPasswordPolicy((p) => ({ ...p, requireSpecial: e.target.checked }))}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
                    />
                    {t('apps.fields.passwordPolicyRequireSpecial')}
                  </label>
                  <div>
                    <Label htmlFor="pwMinSpecial">{t('apps.fields.passwordPolicyMinSpecial')}</Label>
                    <Input
                      id="pwMinSpecial"
                      type="number"
                      min={0}
                      max={passwordPolicy.minLength}
                      disabled={!passwordPolicy.requireSpecial}
                      value={passwordPolicy.minSpecial}
                      onChange={(e) =>
                        setPasswordPolicy((p) => ({
                          ...p,
                          minSpecial: e.target.value === '' ? p.minSpecial : Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="defaultOrgId">{t('apps.fields.defaultOrg')}</Label>
              <Select value={defaultOrgId ?? '__none__'} onValueChange={(v) => setDefaultOrgId(v === '__none__' ? null : v)}>
                <SelectTrigger id="defaultOrgId">
                  <SelectValue placeholder={t('apps.fields.defaultOrgNone')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('apps.fields.defaultOrgNone')}</SelectItem>
                  {appOrgs.map((o) => <SelectItem key={o.publicId} value={o.publicId}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.defaultOrgHint')}
              </p>
            </div>
            <div>
              <Label htmlFor="defaultRoleId">{t('apps.fields.defaultRole')}</Label>
              <Select value={defaultRoleId ?? '__none__'} onValueChange={(v) => setDefaultRoleId(v === '__none__' ? null : v)}>
                <SelectTrigger id="defaultRoleId">
                  <SelectValue placeholder={t('apps.fields.defaultRoleNone')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('apps.fields.defaultRoleNone')}</SelectItem>
                  {appRoles.map((r) => <SelectItem key={r.publicId} value={r.publicId}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.defaultRoleHint')}
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
            <div>
              <Label>{t('apps.fields.clientSecret')}</Label>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.clientSecretHint')}
              </p>
              {newClientSecret ? (
                <div className="mt-2">
                  <div className="flex gap-2">
                    <Input
                      id="newClientSecret"
                      value={newClientSecret}
                      readOnly
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={t('apps.actions.copy')}
                      onClick={() => void copy(newClientSecret, 'clientSecret')}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {copiedKey === 'clientSecret' ? 'check' : 'content_copy'}
                      </span>
                    </Button>
                  </div>
                  <p className="mt-1 text-label-sm text-destructive">
                    {t('apps.fields.clientSecretWarning')}
                  </p>
                </div>
              ) : (
                <div className="mt-2">
                  <p className="text-body-sm text-muted-foreground">
                    {clientSecretUpdatedAt
                      ? t('apps.fields.clientSecretUpdatedAt', {
                          date: new Date(clientSecretUpdatedAt).toLocaleString(),
                        })
                      : t('apps.fields.noClientSecret')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2"
                    loading={rotatingSecret}
                    onClick={handleRotateClientSecret}
                  >
                    {clientSecretUpdatedAt
                      ? t('apps.fields.regenerateClientSecret')
                      : t('apps.fields.generateClientSecret')}
                  </Button>
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="webhookUrl">{t('apps.fields.webhookUrl')}</Label>
              <Input
                id="webhookUrl"
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder={t('apps.fields.webhookUrlPlaceholder')}
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.webhookUrlHint')}
              </p>
            </div>
            <div>
              <Label>{t('apps.fields.webhookSecret')}</Label>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.webhookSecretHint')}
              </p>
              {newWebhookSecret ? (
                <div className="mt-2">
                  <div className="flex gap-2">
                    <Input
                      id="newWebhookSecret"
                      value={newWebhookSecret}
                      readOnly
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={t('apps.actions.copy')}
                      onClick={() => void copy(newWebhookSecret, 'webhookSecret')}
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {copiedKey === 'webhookSecret' ? 'check' : 'content_copy'}
                      </span>
                    </Button>
                  </div>
                  <p className="mt-1 text-label-sm text-destructive">
                    {t('apps.fields.webhookSecretWarning')}
                  </p>
                </div>
              ) : (
                <div className="mt-2">
                  <p className="text-body-sm text-muted-foreground">
                    {hasWebhookSecret ? t('apps.fields.webhookSecretConfigured') : t('apps.fields.noWebhookSecret')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2"
                    loading={rotatingWebhookSecret}
                    disabled={!app.webhookUrl || webhookUrlDirty}
                    onClick={handleRotateWebhookSecret}
                  >
                    {hasWebhookSecret
                      ? t('apps.fields.regenerateWebhookSecret')
                      : t('apps.fields.generateWebhookSecret')}
                  </Button>
                  {(!app.webhookUrl || webhookUrlDirty) && (
                    <p className="mt-1 text-body-sm text-muted-foreground">
                      {t('apps.fields.webhookSecretNeedsUrlHint')}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label>{t('apps.fields.activationEmail')}</Label>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.activationEmailHint')}
              </p>
              <div className="mt-3 space-y-3 rounded border border-[var(--border)] p-3">
                <div>
                  <Label htmlFor="activationFromName">{t('apps.fields.activationEmailFromName')}</Label>
                  <Input
                    id="activationFromName"
                    value={activationFromName}
                    onChange={(e) => setActivationFromName(e.target.value)}
                    placeholder={t('apps.fields.activationEmailFromNamePlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="activationFromAddress">{t('apps.fields.activationEmailFromAddress')}</Label>
                  <Input
                    id="activationFromAddress"
                    type="email"
                    value={activationFromAddress}
                    onChange={(e) => setActivationFromAddress(e.target.value)}
                    placeholder={t('apps.fields.activationEmailFromAddressPlaceholder')}
                  />
                  <p className="mt-1 text-body-sm text-muted-foreground">
                    {t('apps.fields.activationEmailFromAddressHint')}
                  </p>
                </div>
                <div>
                  <Label htmlFor="activationSubject">{t('apps.fields.activationEmailSubject')}</Label>
                  <Input
                    id="activationSubject"
                    value={activationSubject}
                    onChange={(e) => setActivationSubject(e.target.value)}
                    placeholder={t('apps.fields.activationEmailSubjectPlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="activationMessage">{t('apps.fields.activationEmailMessage')}</Label>
                  <Input
                    id="activationMessage"
                    value={activationMessage}
                    onChange={(e) => setActivationMessage(e.target.value)}
                    placeholder={t('apps.fields.activationEmailMessagePlaceholder')}
                  />
                  <p className="mt-1 text-body-sm text-muted-foreground">
                    {t('apps.fields.activationEmailMessageHint')}
                  </p>
                </div>
              </div>
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
