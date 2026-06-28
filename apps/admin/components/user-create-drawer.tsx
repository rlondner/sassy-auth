'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetClose, SheetTitle, SheetDescription,
  Button, ButtonGroup, FormField, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@sassy-auth/ui'
import {
  createUserAction, getRolesAction, getAppPermissionsAction,
} from '@/app/(admin)/users/actions'
import type { Org, Role } from '@/lib/types'
import { RoleRowsEditor, type RoleOption } from './user-role-rows-editor'
import { PermissionRowsEditor, type PermOption } from './role-permission-rows-editor'

interface UserCreateDrawerProps {
  orgs: Org[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface FormState {
  firstName: string
  lastName: string
  email: string
  username: string
  phoneNumber: string
  orgId: string
  roleIds: string[]
  directPermissionIds: string[]
}

const EMPTY: FormState = {
  firstName: '', lastName: '', email: '', username: '', phoneNumber: '',
  orgId: '', roleIds: [], directPermissionIds: [],
}

export function UserCreateDrawer({ orgs, open, onOpenChange }: UserCreateDrawerProps) {
  const t = useTranslations()
  const [form, setForm] = React.useState<FormState>(EMPTY)
  const [roles, setRoles] = React.useState<RoleOption[]>([])
  const [perms, setPerms] = React.useState<PermOption[]>([])
  const [rolesLoading, setRolesLoading] = React.useState(false)
  const [permsLoading, setPermsLoading] = React.useState(false)
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [serverError, setServerError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setForm(EMPTY)
      setErrors({})
      setInviteUrl(null)
      setServerError(null)
      setCopied(false)
    }
  }, [open])

  // Load roles + app permissions in parallel whenever org changes.
  React.useEffect(() => {
    if (!form.orgId) { setRoles([]); setPerms([]); return }
    const selectedOrg = orgs.find((o) => o.id === form.orgId)
    if (!selectedOrg) return
    let cancelled = false
    setRolesLoading(true)
    setPermsLoading(true)
    getRolesAction(selectedOrg.appId).then((r) => {
      if (cancelled) return
      setRoles(r.map((x) => ({ publicId: x.publicId, name: x.name })))
    }).finally(() => { if (!cancelled) setRolesLoading(false) })
    getAppPermissionsAction(selectedOrg.appId).then((p) => {
      if (cancelled) return
      setPerms(p)
    }).finally(() => { if (!cancelled) setPermsLoading(false) })
    return () => { cancelled = true }
  }, [form.orgId, orgs])

  function set<K extends keyof FormState>(field: K) {
    return (value: FormState[K]) => setForm((f) => ({ ...f, [field]: value }))
  }

  function validate(): boolean {
    const e: Partial<Record<keyof FormState, string>> = {}
    if (!form.firstName.trim()) e.firstName = t('users.errors.required')
    if (!form.lastName.trim()) e.lastName = t('users.errors.required')
    if (!form.email.trim()) e.email = t('users.errors.required')
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = t('users.errors.emailInvalid')
    if (!form.orgId) e.orgId = t('users.errors.required')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setSubmitting(true)
    setServerError(null)
    try {
      const result = await createUserAction({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        orgId: form.orgId,
        ...(form.username && { username: form.username }),
        ...(form.phoneNumber && { phoneNumber: form.phoneNumber }),
        ...(form.roleIds.filter((id) => id !== '').length > 0 && {
          roleIds: Array.from(new Set(form.roleIds.filter((id) => id !== ''))),
        }),
        ...(form.directPermissionIds.filter((id) => id !== '').length > 0 && {
          directPermissionIds: Array.from(new Set(form.directPermissionIds.filter((id) => id !== ''))),
        }),
      })
      if ('error' in result) setServerError(result.error)
      else setInviteUrl(result.inviteUrl)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopy() {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const selectedOrg = orgs.find((o) => o.id === form.orgId)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>{t('users.drawer.createTitle')}</SheetTitle>
            <SheetDescription>{t('users.drawer.createSubtitle')}</SheetDescription>
          </div>
          <SheetClose asChild>
            <button className="flex h-7 w-7 items-center justify-center rounded hover:bg-muted">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </SheetClose>
        </SheetHeader>

        {inviteUrl ? (
          <>
            <SheetBody className="flex flex-col items-center gap-6 pt-12 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
                <span className="material-symbols-outlined text-[32px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              </div>
              <div>
                <h2 className="text-headline-sm">{t('users.drawer.inviteCreated')}</h2>
              </div>
              <div className="w-full">
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    className="flex-1 rounded border border-border bg-muted px-3 py-2 text-body-sm font-mono"
                  />
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    <span className="material-symbols-outlined text-[18px]">{copied ? 'check' : 'content_copy'}</span>
                    {copied ? t('users.drawer.copied') : t('users.drawer.copyLink')}
                  </Button>
                </div>
              </div>
            </SheetBody>
            <SheetFooter>
              <Button onClick={() => onOpenChange(false)}>{t('users.drawer.done')}</Button>
            </SheetFooter>
          </>
        ) : (
          <>
            <SheetBody className="flex flex-col gap-6">
              <section>
                <h3 className="mb-4 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.basicInfo')}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label={t('users.fields.firstName')} value={form.firstName} onChange={(e) => set('firstName')(e.target.value)} error={errors.firstName} required />
                  <FormField label={t('users.fields.lastName')} value={form.lastName} onChange={(e) => set('lastName')(e.target.value)} error={errors.lastName} required />
                  <FormField label={t('users.fields.email')} type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} error={errors.email} required className="col-span-2" />
                  <FormField label={`${t('users.fields.username')} ${t('users.fields.optional')}`} value={form.username} onChange={(e) => set('username')(e.target.value)} />
                  <FormField label={`${t('users.fields.phone')} ${t('users.fields.optional')}`} type="tel" value={form.phoneNumber} onChange={(e) => set('phoneNumber')(e.target.value)} />
                </div>
              </section>

              <section>
                <h3 className="mb-4 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.accessPerms')}</h3>
                <div className="flex flex-col gap-1.5 mb-4">
                  <label className="text-label-md font-semibold">{t('users.fields.org')}<span className="ml-0.5 text-destructive">*</span></label>
                  <Select value={form.orgId} onValueChange={set('orgId')}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select org" />
                    </SelectTrigger>
                    <SelectContent>
                      {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {errors.orgId && <p className="text-label-md text-destructive">{errors.orgId}</p>}
                </div>

                <div className="mb-4">
                  <h4 className="mb-2 text-label-md font-semibold">{t('users.drawer.assignedRoles')}</h4>
                  <RoleRowsEditor
                    appId={selectedOrg?.appId ?? ''}
                    roles={roles}
                    rows={form.roleIds}
                    onRowsChange={(next) => set('roleIds')(next)}
                    loading={rolesLoading}
                  />
                </div>

                <div>
                  <h4 className="mb-2 text-label-md font-semibold">{t('users.drawer.assignedDirectPermissions')}</h4>
                  <PermissionRowsEditor
                    appId={selectedOrg?.appId ?? ''}
                    perms={perms}
                    rows={form.directPermissionIds}
                    onRowsChange={(next) => set('directPermissionIds')(next)}
                    loading={permsLoading}
                  />
                </div>
              </section>

              {serverError && (
                <p role="alert" className="rounded border border-destructive/20 bg-destructive/10 px-3 py-2 text-body-sm text-destructive">
                  {serverError}
                </p>
              )}
            </SheetBody>

            <SheetFooter>
              <ButtonGroup>
                <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>{t('users.drawer.cancel')}</Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? '…' : t('users.drawer.create')}
                </Button>
              </ButtonGroup>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
