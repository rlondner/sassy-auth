'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetClose, SheetTitle,
  Button, ButtonGroup, UserAvatar, StatusChip, Badge,
} from '@sassy-auth/ui'
import { DeleteAlertDialog } from './delete-alert-dialog'
import {
  getUserRolesAction,
  getEffectivePermissionsAction,
  updateUserAction,
  deleteUserAction,
} from '@/app/(admin)/users/actions'

import type { User, Role, Permission } from '@/lib/types'

const MAX_PERMISSIONS_SHOWN = 5

interface UserViewDrawerProps {
  user: User | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserViewDrawer({ user, open, onOpenChange }: UserViewDrawerProps) {
  const t = useTranslations()
  const [roles, setRoles] = React.useState<Role[]>([])
  const [permissions, setPermissions] = React.useState<Permission[]>([])
  const [loading, setLoading] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [showAllPerms, setShowAllPerms] = React.useState(false)
  const [editValues, setEditValues] = React.useState({ firstName: '', lastName: '', phoneNumber: '', username: '' })
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || !user) return
    setLoading(true)
    setEditing(false)
    setShowAllPerms(false)
    setEditValues({ firstName: user.firstName, lastName: user.lastName, phoneNumber: user.phoneNumber ?? '', username: user.username ?? '' })
    Promise.all([getUserRolesAction(user.id), getEffectivePermissionsAction(user.id)])
      .then(([r, p]) => { setRoles(r); setPermissions(p) })
      .finally(() => setLoading(false))
  }, [open, user?.id])

  async function handleSave() {
    if (!user) return
    setSaving(true)
    try {
      await updateUserAction(user.id, {
        firstName: editValues.firstName,
        lastName: editValues.lastName,
        phoneNumber: editValues.phoneNumber || null,
        username: editValues.username || null,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const visiblePermissions = showAllPerms ? permissions : permissions.slice(0, MAX_PERMISSIONS_SHOWN)
  const hiddenCount = permissions.length - MAX_PERMISSIONS_SHOWN

  if (!user) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {/* Header */}
        <SheetHeader>
          <div>
            <SheetTitle>{user.firstName} {user.lastName}</SheetTitle>
            <p className="text-body-sm text-muted-foreground">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <ButtonGroup>
                <Button variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={saving}>{t('users.drawer.cancel')}</Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '…' : t('users.drawer.save')}</Button>
              </ButtonGroup>
            ) : (
              <ButtonGroup>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive text-destructive"
                  onClick={() => { setDeleteError(null); setDeleteOpen(true) }}
                >
                  {t('users.actions.delete')}
                </Button>
                <Button variant="outline" size="sm">{t('users.drawer.resetPassword')}</Button>
                <Button size="sm" onClick={() => setEditing(true)}>{t('users.drawer.edit')}</Button>
              </ButtonGroup>
            )}
            <SheetClose asChild>
              <button className="ml-2 flex h-7 w-7 items-center justify-center rounded hover:bg-muted">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </SheetClose>
          </div>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-6">
          {/* Profile card */}
          <div className="overflow-hidden rounded-lg border border-border">
            {/* Banner */}
            <div className="relative h-20 bg-gradient-to-r from-brand-600 to-indigo-800">
              <div className="absolute -bottom-6 left-6">
                <UserAvatar
                  firstName={user.firstName}
                  lastName={user.lastName}
                  size="lg"
                  className="border-2 border-white"
                />
              </div>
              <div className="absolute right-4 top-4">
                <StatusChip variant={user.status} label={t(`users.status.${user.status}`)} />
              </div>
            </div>

            {/* Profile fields */}
            <div className="px-6 pb-6 pt-10">
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('users.fields.firstName')}>
                  {editing
                    ? <input value={editValues.firstName} onChange={(e) => setEditValues(v => ({ ...v, firstName: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" />
                    : user.firstName}
                </Field>
                <Field label={t('users.fields.lastName')}>
                  {editing
                    ? <input value={editValues.lastName} onChange={(e) => setEditValues(v => ({ ...v, lastName: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" />
                    : user.lastName}
                </Field>
                <Field label={t('users.fields.phone')}>
                  {editing
                    ? <input value={editValues.phoneNumber} onChange={(e) => setEditValues(v => ({ ...v, phoneNumber: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" placeholder={t('users.fields.optional')} />
                    : (user.phoneNumber ?? <span className="text-muted-foreground">—</span>)}
                </Field>
                <Field label={t('users.fields.username')}>
                  {editing
                    ? <input value={editValues.username} onChange={(e) => setEditValues(v => ({ ...v, username: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" placeholder={t('users.fields.optional')} />
                    : (user.username ?? <span className="text-muted-foreground">—</span>)}
                </Field>
                <Field label={t('users.fields.userId')}>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-label-md font-mono">{user.id}</code>
                </Field>
                <Field label={t('users.fields.lastLogin')}>
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : t('users.fields.never')}
                </Field>
              </div>
            </div>
          </div>

          {/* Access section */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-headline-sm">{t('users.drawer.grantAccess')}</h3>
            </div>
            {loading ? (
              <p className="text-body-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.assignedRoles')}</p>
                    <div className="flex flex-wrap gap-2">
                      {roles.length === 0
                        ? <span className="text-body-sm text-muted-foreground">—</span>
                        : roles.map((r) => <Badge key={r.publicId} variant="secondary">{r.name}</Badge>)}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.effectivePermissions')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {visiblePermissions.map((p) => (
                        <span key={p.id} className="rounded border border-border px-2 py-0.5 text-label-md">{p.name}</span>
                      ))}
                      {!showAllPerms && hiddenCount > 0 && (
                        <button onClick={() => setShowAllPerms(true)} className="text-label-md text-primary hover:underline">
                          {t('users.drawer.nMorePermissions', { count: hiddenCount })}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </SheetBody>
      </SheetContent>
      <DeleteAlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('users.confirmDelete.title')}
        description={t('users.confirmDelete.body', { name: `${user.firstName} ${user.lastName}` })}
        confirmLabel={t('users.confirmDelete.button')}
        cancelLabel={t('users.drawer.cancel')}
        error={deleteError}
        onConfirm={async () => {
          const result = await deleteUserAction(user.id)
          if ('errorKey' in result) {
            setDeleteError(t(result.errorKey))
            return
          }
          onOpenChange(false)
        }}
      />
    </Sheet>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 text-body-sm text-foreground">{children}</div>
    </div>
  )
}
