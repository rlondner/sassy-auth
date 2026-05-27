'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter, SheetClose, SheetTitle, SheetDescription,
  Button, FormField, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@sassy-auth/ui'
import { getRoles } from '@/lib/api'
import { createUserAction } from '@/app/(admin)/users/actions'
import type { Org, Role } from '@/lib/types'

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
  roleId: string
}

const EMPTY: FormState = { firstName: '', lastName: '', email: '', username: '', phoneNumber: '', orgId: '', roleId: '' }

export function UserCreateDrawer({ orgs, open, onOpenChange }: UserCreateDrawerProps) {
  const t = useTranslations()
  const [form, setForm] = React.useState<FormState>(EMPTY)
  const [roles, setRoles] = React.useState<Role[]>([])
  const [errors, setErrors] = React.useState<Partial<FormState>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [serverError, setServerError] = React.useState<string | null>(null)

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setForm(EMPTY)
      setErrors({})
      setInviteUrl(null)
      setServerError(null)
      setCopied(false)
    }
  }, [open])

  // Load roles when org changes
  React.useEffect(() => {
    if (!form.orgId) { setRoles([]); return }
    const selectedOrg = orgs.find((o) => o.id === form.orgId)
    if (!selectedOrg) return
    getRoles(selectedOrg.appId).then(setRoles)
  }, [form.orgId, orgs])

  function set(field: keyof FormState) {
    return (value: string) => setForm((f) => ({ ...f, [field]: value }))
  }

  function validate(): boolean {
    const e: Partial<FormState> = {}
    if (!form.firstName.trim()) e.firstName = 'Required'
    if (!form.lastName.trim()) e.lastName = 'Required'
    if (!form.email.trim()) e.email = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email'
    if (!form.orgId) e.orgId = 'Required'
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
        ...(form.roleId && { roleId: form.roleId }),
      })
      if ('error' in result) {
        setServerError(result.error)
      } else {
        setInviteUrl(result.inviteUrl)
      }
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>{t('users.drawer.createTitle')}</SheetTitle>
            <SheetDescription>{t('users.drawer.createSubtitle')}</SheetDescription>
          </div>
          <SheetClose asChild>
            <button className="flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--muted)]">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </SheetClose>
        </SheetHeader>

        {inviteUrl ? (
          /* Success state */
          <>
            <SheetBody className="flex flex-col items-center gap-6 pt-12 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--secondary)]">
                <span className="material-symbols-outlined text-[32px] text-[var(--primary)]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              </div>
              <div>
                <h2 className="text-headline-sm">{t('users.drawer.inviteCreated')}</h2>
              </div>
              <div className="w-full">
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    className="flex-1 rounded border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-body-sm font-mono"
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
          /* Form */
          <>
            <SheetBody className="flex flex-col gap-6">
              {/* Basic Info */}
              <section>
                <h3 className="mb-4 text-label-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">{t('users.drawer.basicInfo')}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    label={t('users.fields.firstName')}
                    value={form.firstName}
                    onChange={(e) => set('firstName')(e.target.value)}
                    error={errors.firstName}
                    required
                  />
                  <FormField
                    label={t('users.fields.lastName')}
                    value={form.lastName}
                    onChange={(e) => set('lastName')(e.target.value)}
                    error={errors.lastName}
                    required
                  />
                  <FormField
                    label={t('users.fields.email')}
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email')(e.target.value)}
                    error={errors.email}
                    required
                    className="col-span-2"
                  />
                  <FormField
                    label={`${t('users.fields.username')} ${t('users.fields.optional')}`}
                    value={form.username}
                    onChange={(e) => set('username')(e.target.value)}
                  />
                  <FormField
                    label={`${t('users.fields.phone')} ${t('users.fields.optional')}`}
                    type="tel"
                    value={form.phoneNumber}
                    onChange={(e) => set('phoneNumber')(e.target.value)}
                  />
                </div>
              </section>

              {/* Access */}
              <section>
                <h3 className="mb-4 text-label-sm font-bold uppercase tracking-wider text-[var(--muted-foreground)]">{t('users.drawer.accessPerms')}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-label-md font-semibold">{t('users.fields.org')}<span className="ml-0.5 text-[var(--destructive)]">*</span></label>
                    <Select value={form.orgId} onValueChange={set('orgId')}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select org" />
                      </SelectTrigger>
                      <SelectContent>
                        {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {errors.orgId && <p className="text-label-md text-[var(--destructive)]">{errors.orgId}</p>}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-label-md font-semibold">{t('users.fields.role')}</label>
                    <Select value={form.roleId} onValueChange={set('roleId')} disabled={!form.orgId || roles.length === 0}>
                      <SelectTrigger>
                        <SelectValue placeholder={form.orgId ? 'Select role' : 'Select org first'} />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              {serverError && (
                <p className="rounded border border-[var(--destructive)]/20 bg-[#ffdad6]/30 px-3 py-2 text-body-sm text-[var(--destructive)]">
                  {serverError}
                </p>
              )}
            </SheetBody>

            <SheetFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>{t('users.drawer.cancel')}</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? '…' : t('users.drawer.create')}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
