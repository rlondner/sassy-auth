'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle, Button, ButtonGroup, Badge } from '@sassy-auth/ui'
import { useCopyFeedback } from '@/lib/use-copy-feedback'
import { getAppAction, getSocialProviderSettingsAction } from '@/app/(admin)/apps/actions'
import { listOrgsAction } from '@/app/(admin)/orgs/actions'
import { listRolesAction } from '@/app/(admin)/roles/actions'
import type { App, RedirectUri, OrgRow, RoleRow } from '@/lib/types'

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

  // The list `app` is sourced from can be stale for anything that changes
  // outside the save/dirty flow — most notably a client-secret or
  // webhook-secret rotation, which PATCHes the auth-server directly and
  // never updates the parent table's row (see AppEditDrawer's
  // handleRotate* — those intentionally skip `onSuccess` so an in-progress
  // edit elsewhere in the drawer isn't reset). It also strips `logo` to
  // avoid shipping every row's base64 blob on a page load. Re-fetching the
  // single-app record on open and rendering from it (falling back to `app`
  // until that resolves) picks up both cases. Org/role names for
  // defaultOrgId/defaultRoleId and the enabled social providers are
  // likewise only available from their own endpoints.
  const [displayApp, setDisplayApp] = React.useState<App>(app)
  const [appOrgs, setAppOrgs] = React.useState<OrgRow[]>([])
  const [appRoles, setAppRoles] = React.useState<RoleRow[]>([])
  const [enabledProviders, setEnabledProviders] = React.useState<string[]>([])

  React.useEffect(() => {
    setDisplayApp(app)
    if (!open) return
    let cancelled = false
    getAppAction(app.publicId).then((result) => {
      if (!cancelled && 'app' in result) setDisplayApp(result.app)
    })
    getSocialProviderSettingsAction(app.publicId).then((result) => {
      if (!cancelled && 'enabled' in result) setEnabledProviders(result.enabled)
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

  const defaultOrgName = displayApp.defaultOrgId
    ? appOrgs.find((o) => o.publicId === displayApp.defaultOrgId)?.name ?? displayApp.defaultOrgId
    : null
  const defaultRoleName = displayApp.defaultRoleId
    ? appRoles.find((r) => r.publicId === displayApp.defaultRoleId)?.name ?? displayApp.defaultRoleId
    : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="xl">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-border bg-muted text-primary">
              <span className="material-symbols-outlined text-[20px]">apps</span>
            </div>
            <SheetTitle>{displayApp.name}</SheetTitle>
            {displayApp.isPlatform && <Badge variant="secondary">{t('apps.badges.platform')}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {!displayApp.isPlatform && (
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
            value={displayApp.url}
            onCopy={() => copy(displayApp.url, 'url')}
            copied={copied === 'url'}
            copyLabel={t('apps.actions.copy')}
          />
          <div>
            <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('apps.fields.logo')}</p>
            <div className="mt-1 flex items-center rounded border border-border bg-card px-3 py-2">
              {displayApp.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayApp.logo} alt={t('apps.fields.logo')} className="h-10 w-10 rounded border border-border object-contain" />
              ) : (
                <span className="text-body-sm text-muted-foreground">{t('apps.fields.noLogo')}</span>
              )}
            </div>
          </div>
          <RedirectUriGroup
            label={t('apps.fields.loginRedirectUris')}
            uris={(displayApp.redirectUris ?? []).filter((r) => r.kind === 'login')}
            copy={copy}
            copied={copied}
            copyLabel={t('apps.actions.copy')}
            emptyLabel={t('apps.fields.noRedirectUris')}
          />
          <RedirectUriGroup
            label={t('apps.fields.postLogoutRedirectUris')}
            uris={(displayApp.redirectUris ?? []).filter((r) => r.kind === 'post_logout')}
            copy={copy}
            copied={copied}
            copyLabel={t('apps.actions.copy')}
            emptyLabel={t('apps.fields.noRedirectUris')}
          />
          <TextRow
            label={t('apps.fields.twoFactorTrustDays')}
            value={displayApp.twoFactorTrustDays != null ? String(displayApp.twoFactorTrustDays) : t('apps.fields.twoFactorTrustDaysSystemDefault')}
          />
          <TextRow
            label={t('apps.fields.requireTwoFactor')}
            value={displayApp.requireTwoFactor ? t('common.yes') : t('common.no')}
          />
          <div>
            <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('apps.fields.passwordPolicy')}</p>
            {displayApp.passwordPolicyOverride === null ? (
              <div className="mt-1 rounded border border-border bg-card px-3 py-2">
                <span className="text-body-sm text-muted-foreground">
                  {t('apps.fields.passwordPolicyInherited', { summary: `${displayApp.effectivePasswordPolicy.minLength}+ chars` })}
                </span>
              </div>
            ) : (
              <div className="mt-1 space-y-1">
                <SubTextRow label={t('apps.fields.passwordPolicyMinLength')} value={String(displayApp.passwordPolicyOverride.minLength)} />
                <SubTextRow label={t('apps.fields.passwordPolicyRequireUppercase')} value={displayApp.passwordPolicyOverride.requireUppercase ? t('common.yes') : t('common.no')} />
                <SubTextRow label={t('apps.fields.passwordPolicyRequireLowercase')} value={displayApp.passwordPolicyOverride.requireLowercase ? t('common.yes') : t('common.no')} />
                <SubTextRow
                  label={t('apps.fields.passwordPolicyRequireNumber')}
                  value={
                    displayApp.passwordPolicyOverride.requireNumber
                      ? `${t('common.yes')} (${t('apps.fields.passwordPolicyMinNumbers')}: ${displayApp.passwordPolicyOverride.minNumbers})`
                      : t('common.no')
                  }
                />
                <SubTextRow
                  label={t('apps.fields.passwordPolicyRequireSpecial')}
                  value={
                    displayApp.passwordPolicyOverride.requireSpecial
                      ? `${t('common.yes')} (${t('apps.fields.passwordPolicyMinSpecial')}: ${displayApp.passwordPolicyOverride.minSpecial})`
                      : t('common.no')
                  }
                />
              </div>
            )}
          </div>
          <TextRow label={t('apps.fields.defaultOrg')} value={defaultOrgName ?? t('apps.fields.defaultOrgNone')} />
          <TextRow label={t('apps.fields.defaultRole')} value={defaultRoleName ?? t('apps.fields.defaultRoleNone')} />
          <div>
            <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('apps.fields.socialProviders')}</p>
            <div className="mt-1 rounded border border-border bg-card px-3 py-2">
              {enabledProviders.length === 0 ? (
                <span className="text-body-sm text-muted-foreground">{t('apps.fields.socialProvidersNone')}</span>
              ) : (
                <span className="text-body-sm">
                  {enabledProviders
                    .map((p) =>
                      t.has(`apps.fields.socialProviderNames.${p}`)
                        ? t(`apps.fields.socialProviderNames.${p}` as 'apps.fields.socialProviderNames.google')
                        : p,
                    )
                    .join(', ')}
                </span>
              )}
            </div>
          </div>
          <DetailRow
            label={t('apps.fields.publicId')}
            value={displayApp.publicId}
            mono
            onCopy={() => copy(displayApp.publicId, 'sqid')}
            copied={copied === 'sqid'}
            copyLabel={t('apps.actions.copy')}
          />
          <TextRow
            label={t('apps.fields.clientSecret')}
            value={
              displayApp.clientSecretUpdatedAt
                ? t('apps.fields.clientSecretUpdatedAt', { date: new Date(displayApp.clientSecretUpdatedAt).toLocaleString() })
                : t('apps.fields.noClientSecret')
            }
          />
          <TextRow
            label={t('apps.fields.webhookUrl')}
            value={displayApp.activationWebhookUrl ?? t('apps.fields.noWebhookUrl')}
          />
          <TextRow
            label={t('apps.fields.webhookSecret')}
            value={displayApp.hasActivationWebhookSecret ? t('apps.fields.webhookSecretConfigured') : t('apps.fields.noWebhookSecret')}
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

function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 rounded border border-border bg-card px-3 py-2">
        <span className="text-body-sm">{value}</span>
      </div>
    </div>
  )
}

function SubTextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded border border-border bg-card px-3 py-2">
      <span className="text-body-sm text-muted-foreground">{label}</span>
      <span className="text-body-sm">{value}</span>
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
