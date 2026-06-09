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
  getUserDirectPermissionsAction,
  setUserRolesAction,
  setUserDirectPermissionsAction,
  getRolesAction,
  getAppPermissionsAction,
  updateUserAction,
  deleteUserAction,
} from '@/app/(admin)/users/actions'
import { RoleRowsEditor, type RoleOption } from './user-role-rows-editor'
import { PermissionRowsEditor, type PermOption } from './role-permission-rows-editor'

import type { User, Role, Permission, Org } from '@/lib/types'

const MAX_PERMISSIONS_SHOWN = 5

interface UserViewDrawerProps {
  user: User | null
  orgs: Org[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ProfileSnapshot {
  firstName: string
  lastName: string
  phoneNumber: string
  username: string
}

export function UserViewDrawer({ user, orgs, open, onOpenChange }: UserViewDrawerProps) {
  const t = useTranslations()
  const [roles, setRoles] = React.useState<Role[]>([])
  const [permissions, setPermissions] = React.useState<Permission[]>([])
  const [directPermissions, setDirectPermissions] = React.useState<Permission[]>([])
  const [loading, setLoading] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [showAllPerms, setShowAllPerms] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  // Edit-mode form state
  const [editProfile, setEditProfile] = React.useState<ProfileSnapshot>({ firstName: '', lastName: '', phoneNumber: '', username: '' })
  const [profileSnap, setProfileSnap] = React.useState<ProfileSnapshot>({ firstName: '', lastName: '', phoneNumber: '', username: '' })
  const [roleRows, setRoleRows] = React.useState<string[]>([])
  const [roleRowsSnap, setRoleRowsSnap] = React.useState<string[]>([])
  const [permRows, setPermRows] = React.useState<string[]>([])
  const [permRowsSnap, setPermRowsSnap] = React.useState<string[]>([])

  // Edit-mode option lists (scoped to the user's org's app)
  const [roleOptions, setRoleOptions] = React.useState<RoleOption[]>([])
  const [permOptions, setPermOptions] = React.useState<PermOption[]>([])
  const [optionsLoading, setOptionsLoading] = React.useState(false)

  // Per-axis save errors
  const [profileError, setProfileError] = React.useState<string | null>(null)
  const [rolesError, setRolesError] = React.useState<string | null>(null)
  const [permsError, setPermsError] = React.useState<string | null>(null)

  const userOrg = user ? orgs.find((o) => o.id === user.orgId) : undefined
  const appId = userOrg?.appId ?? ''

  // Initial load when the drawer opens or user changes.
  React.useEffect(() => {
    if (!open || !user) return
    setLoading(true)
    setEditing(false)
    setShowAllPerms(false)
    setProfileError(null); setRolesError(null); setPermsError(null)
    Promise.all([
      getUserRolesAction(user.id),
      getEffectivePermissionsAction(user.id),
      getUserDirectPermissionsAction(user.id),
    ])
      .then(([r, p, d]) => { setRoles(r); setPermissions(p); setDirectPermissions(d) })
      .finally(() => setLoading(false))
  }, [open, user?.id])

  // When entering edit mode, snapshot current state and fetch role + perm
  // options. Snapshot lets Cancel restore exactly the loaded state, and
  // lets Save compute per-axis "dirty" with a stable baseline that does
  // not move once a successful axis re-fetches.
  React.useEffect(() => {
    if (!editing || !user) return
    const profile: ProfileSnapshot = {
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber ?? '',
      username: user.username ?? '',
    }
    setEditProfile(profile); setProfileSnap(profile)
    const rIds = roles.map((r) => r.publicId)
    setRoleRows(rIds); setRoleRowsSnap(rIds)
    const pIds = directPermissions.map((p) => p.id)
    setPermRows(pIds); setPermRowsSnap(pIds)
    if (!appId) return
    let cancelled = false
    setOptionsLoading(true)
    Promise.all([getRolesAction(appId), getAppPermissionsAction(appId)])
      .then(([rOpts, pOpts]) => {
        if (cancelled) return
        setRoleOptions(rOpts.map((r) => ({ publicId: r.publicId, name: r.name })))
        setPermOptions(pOpts)
      })
      .finally(() => { if (!cancelled) setOptionsLoading(false) })
    return () => { cancelled = true }
  }, [editing, user?.id, appId])

  function setsEqual(a: string[], b: string[]): boolean {
    const A = new Set(a.filter((x) => x !== ''))
    const B = new Set(b.filter((x) => x !== ''))
    if (A.size !== B.size) return false
    for (const v of A) if (!B.has(v)) return false
    return true
  }

  const profileDirty = !!user && (
    editProfile.firstName !== profileSnap.firstName ||
    editProfile.lastName !== profileSnap.lastName ||
    editProfile.phoneNumber !== profileSnap.phoneNumber ||
    editProfile.username !== profileSnap.username
  )
  const rolesDirty = !setsEqual(roleRows, roleRowsSnap)
  const permsDirty = !setsEqual(permRows, permRowsSnap)

  async function handleSave() {
    if (!user) return
    setSaving(true)
    setProfileError(null); setRolesError(null); setPermsError(null)
    const cleanRoleIds = Array.from(new Set(roleRows.filter((id) => id !== '')))
    const cleanPermIds = Array.from(new Set(permRows.filter((id) => id !== '')))

    const tasks: Array<Promise<{ axis: 'profile' | 'roles' | 'perms'; ok: boolean; errorKey?: string; error?: string }>> = []

    if (profileDirty) {
      tasks.push(
        updateUserAction(user.id, {
          firstName: editProfile.firstName,
          lastName: editProfile.lastName,
          phoneNumber: editProfile.phoneNumber || null,
          username: editProfile.username || null,
        })
          .then(() => ({ axis: 'profile' as const, ok: true }))
          .catch((e: unknown): { axis: 'profile'; ok: false; errorKey?: string; error?: string } =>
            e instanceof Error
              ? { axis: 'profile', ok: false, error: e.message }
              : { axis: 'profile', ok: false, errorKey: 'users.errors.generic' },
          ),
      )
    }
    if (rolesDirty) {
      tasks.push(
        setUserRolesAction(user.id, cleanRoleIds).then((r) =>
          'ok' in r
            ? { axis: 'roles' as const, ok: true }
            : { axis: 'roles' as const, ok: false, errorKey: r.errorKey }
        ),
      )
    }
    if (permsDirty) {
      tasks.push(
        setUserDirectPermissionsAction(user.id, cleanPermIds).then((r) =>
          'ok' in r
            ? { axis: 'perms' as const, ok: true }
            : { axis: 'perms' as const, ok: false, errorKey: r.errorKey }
        ),
      )
    }

    const results = await Promise.all(tasks)
    let allOk = true
    for (const r of results) {
      if (!r.ok) {
        allOk = false
        const msg = r.errorKey ? t(r.errorKey) : (r.error ?? '')
        if (r.axis === 'profile') setProfileError(msg)
        if (r.axis === 'roles') setRolesError(msg)
        if (r.axis === 'perms') setPermsError(msg)
      } else {
        // Reset that axis's snapshot to what we just sent so re-Save only
        // retries the failed axis. Set-replace is idempotent so retrying
        // a succeeded axis is also safe.
        if (r.axis === 'profile') setProfileSnap(editProfile)
        if (r.axis === 'roles') setRoleRowsSnap(cleanRoleIds)
        if (r.axis === 'perms') setPermRowsSnap(cleanPermIds)
      }
    }

    // Re-fetch the Access lists so the read view (and effective perms) reflect
    // whatever just persisted.
    try {
      const [r, p, d] = await Promise.all([
        getUserRolesAction(user.id),
        getEffectivePermissionsAction(user.id),
        getUserDirectPermissionsAction(user.id),
      ])
      setRoles(r); setPermissions(p); setDirectPermissions(d)
    } catch {
      /* tolerate refresh failure — next open will reload */
    }

    setSaving(false)
    if (allOk) setEditing(false)
  }

  function handleCancel() {
    setEditing(false)
    setEditProfile(profileSnap)
    setRoleRows(roleRowsSnap)
    setPermRows(permRowsSnap)
    setProfileError(null); setRolesError(null); setPermsError(null)
  }

  const visiblePermissions = showAllPerms ? permissions : permissions.slice(0, MAX_PERMISSIONS_SHOWN)
  const hiddenCount = permissions.length - MAX_PERMISSIONS_SHOWN

  if (!user) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>{user.firstName} {user.lastName}</SheetTitle>
            <p className="text-body-sm text-muted-foreground">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <ButtonGroup>
                <Button variant="secondary" size="sm" onClick={handleCancel} disabled={saving}>{t('users.drawer.cancel')}</Button>
                <Button size="sm" onClick={handleSave} loading={saving}>{t('users.drawer.save')}</Button>
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
            <div className="relative h-20 bg-gradient-to-r from-brand-600 to-indigo-800">
              <div className="absolute -bottom-6 left-6">
                <UserAvatar firstName={user.firstName} lastName={user.lastName} size="lg" className="border-2 border-white" />
              </div>
              <div className="absolute right-4 top-4">
                <StatusChip variant={user.status} label={t(`users.status.${user.status}`)} />
              </div>
            </div>
            <div className="px-6 pb-6 pt-10">
              {profileError && (
                <p role="alert" className="mb-3 rounded border border-destructive/20 bg-destructive/10 px-3 py-2 text-body-sm text-destructive">{profileError}</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('users.fields.firstName')}>
                  {editing
                    ? <input value={editProfile.firstName} onChange={(e) => setEditProfile((v) => ({ ...v, firstName: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" />
                    : user.firstName}
                </Field>
                <Field label={t('users.fields.lastName')}>
                  {editing
                    ? <input value={editProfile.lastName} onChange={(e) => setEditProfile((v) => ({ ...v, lastName: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" />
                    : user.lastName}
                </Field>
                <Field label={t('users.fields.phone')}>
                  {editing
                    ? <input value={editProfile.phoneNumber} onChange={(e) => setEditProfile((v) => ({ ...v, phoneNumber: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" placeholder={t('users.fields.optional')} />
                    : (user.phoneNumber ?? <span className="text-muted-foreground">—</span>)}
                </Field>
                <Field label={t('users.fields.username')}>
                  {editing
                    ? <input value={editProfile.username} onChange={(e) => setEditProfile((v) => ({ ...v, username: e.target.value }))} className="w-full rounded border border-border px-2 py-1 text-body-sm" placeholder={t('users.fields.optional')} />
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
            ) : editing ? (
              <div className="space-y-6">
                <div>
                  <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.assignedRoles')}</p>
                  {rolesError && (
                    <p role="alert" className="mb-2 rounded border border-destructive/20 bg-destructive/10 px-3 py-2 text-body-sm text-destructive">{rolesError}</p>
                  )}
                  <RoleRowsEditor
                    appId={appId}
                    roles={roleOptions}
                    rows={roleRows}
                    onRowsChange={setRoleRows}
                    loading={optionsLoading}
                  />
                </div>
                <div>
                  <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.assignedDirectPermissions')}</p>
                  {permsError && (
                    <p role="alert" className="mb-2 rounded border border-destructive/20 bg-destructive/10 px-3 py-2 text-body-sm text-destructive">{permsError}</p>
                  )}
                  <PermissionRowsEditor
                    appId={appId}
                    perms={permOptions}
                    rows={permRows}
                    onRowsChange={setPermRows}
                    loading={optionsLoading}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.assignedRoles')}</p>
                    <div className="flex flex-wrap gap-2">
                      {roles.length === 0
                        ? <span className="text-body-sm text-muted-foreground">—</span>
                        : roles.map((r) => <Badge key={r.publicId} variant="secondary">{r.name}</Badge>)}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('users.drawer.assignedDirectPermissions')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {directPermissions.length === 0
                        ? <span className="text-body-sm text-muted-foreground">—</span>
                        : directPermissions.map((p) => (
                            <span key={p.id} className="rounded border border-border px-2 py-0.5 text-label-md">{p.name}</span>
                          ))}
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
