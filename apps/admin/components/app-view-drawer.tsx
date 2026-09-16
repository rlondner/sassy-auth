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

  // GET /api/apps (the list `app` is sourced from) strips `logo` to avoid
  // shipping every row's base64 blob on a page load — fetch the single-app
  // record for the real value, same as the edit drawer does. Org/role names
  // for defaultOrgId/defaultRoleId and the enabled social providers are
  // likewise only available from their own endpoints.
  const [logo, setLogo] = React.useState<string | null>(app.logo ?? null)
  const [appOrgs, setAppOrgs] = React.useState<OrgRow[]>([])
  const [appRoles, setAppRoles] = React.useState<RoleRow[]>([])
  const [enabledProviders, setEnabledProviders] = React.useState<string[]>([])

  React.useEffect(() => {
    setLogo(app.logo ?? null)
    if (!open) return
    let cancelled = false
    getAppAction(app.publicId).then((result) => {
      if (!cancelled && 'app' in result) setLogo(result.app.logo ?? null)
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

  const defaultOrgName = app.defaultOrgId
    ? appOrgs.find((o) => o.publicId === app.defaultOrgId)?.name ?? app.defaultOrgId
    : null
  const defaultRoleName = app.defaultRoleId
    ? appRoles.find((r) => r.publicId === app.defaultRoleId)?.name ?? app.defaultRoleId
    : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="xl">
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
          <div>
            <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('apps.fields.logo')}</p>
            <div className="mt-1 flex items-center rounded border border-border bg-card px-3 py-2">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt={t('apps.fields.logo')} className="h-10 w-10 rounded border border-border object-contain" />
              ) : (
                <span className="text-body-sm text-muted-foreground">{t('apps.fields.noLogo')}</span>
              )}
            </div>
          </div>
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
          <TextRow
            label={t('apps.fields.twoFactorTrustDays')}
            value={app.twoFactorTrustDays != null ? String(app.twoFactorTrustDays) : t('apps.fields.twoFactorTrustDaysSystemDefault')}
          />
          <TextRow
            label={t('apps.fields.requireTwoFactor')}
            value={app.requireTwoFactor ? t('common.yes') : t('common.no')}
          />
          <div>
            <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('apps.fields.passwordPolicy')}</p>
            {app.passwordPolicyOverride === null ? (
              <div className="mt-1 rounded border border-border bg-card px-3 py-2">
                <span className="text-body-sm text-muted-foreground">
                  {t('apps.fields.passwordPolicyInherited', { summary: `${app.effectivePasswordPolicy.minLength}+ chars` })}
                </span>
              </div>
            ) : (
              <div className="mt-1 space-y-1">
                <SubTextRow label={t('apps.fields.passwordPolicyMinLength')} value={String(app.passwordPolicyOverride.minLength)} />
                <SubTextRow label={t('apps.fields.passwordPolicyRequireUppercase')} value={app.passwordPolicyOverride.requireUppercase ? t('common.yes') : t('common.no')} />
                <SubTextRow label={t('apps.fields.passwordPolicyRequireLowercase')} value={app.passwordPolicyOverride.requireLowercase ? t('common.yes') : t('common.no')} />
                <SubTextRow
                  label={t('apps.fields.passwordPolicyRequireNumber')}
                  value={
                    app.passwordPolicyOverride.requireNumber
                      ? `${t('common.yes')} (${t('apps.fields.passwordPolicyMinNumbers')}: ${app.passwordPolicyOverride.minNumbers})`
                      : t('common.no')
                  }
                />
                <SubTextRow
                  label={t('apps.fields.passwordPolicyRequireSpecial')}
                  value={
                    app.passwordPolicyOverride.requireSpecial
                      ? `${t('common.yes')} (${t('apps.fields.passwordPolicyMinSpecial')}: ${app.passwordPolicyOverride.minSpecial})`
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
            value={app.publicId}
            mono
            onCopy={() => copy(app.publicId, 'sqid')}
            copied={copied === 'sqid'}
            copyLabel={t('apps.actions.copy')}
          />
          <TextRow
            label={t('apps.fields.clientSecret')}
            value={
              app.clientSecretUpdatedAt
                ? t('apps.fields.clientSecretUpdatedAt', { date: new Date(app.clientSecretUpdatedAt).toLocaleString() })
                : t('apps.fields.noClientSecret')
            }
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
