'use server'

import { revalidatePath } from 'next/cache'
import {
  createUser,
  getUserRoles,
  getEffectivePermissions,
  getUserDirectPermissions,
  setUserRoles,
  setUserDirectPermissions,
  getRoles,
  getPermissions,
  updateUser,
  deleteUser,
  resetPassword,
  resendInvitation,
} from '@/lib/api'
import { isRedirectSentinel } from '@/lib/redirect-sentinel'
import type { CreateUserPayload, Permission, Role, User } from '@/lib/types'

interface CreateUserInput extends CreateUserPayload {
  /** Legacy single-role field — supported for callers not yet on roleIds. */
  roleId?: string
}

// bug-0234: since bug-0050 made `apiFetch` fold the NestJS response body
// into the thrown Error message, returning `err.message` to the client
// leaks server internals (service paths, stack frames, query structure,
// validation internals) into a `<p>` in the drawer. Map to a stable i18n
// key instead — the same shape the orgs/apps/roles/permissions actions
// already use — and let the raw error stay server-side where the API
// client's Sentry capture already records it.
function mapUserError(
  err: unknown,
  opts: { on409?: string; on403Own?: string } = {},
): string {
  const message = err instanceof Error ? err.message : ''
  if (opts.on409 && (message.includes('409') || message.includes('already'))) return opts.on409
  if (opts.on403Own && message.includes('403') && /\bown\b/i.test(message)) return opts.on403Own
  if (message.includes('403')) return 'users.errors.forbidden'
  if (message.includes('400')) return 'users.errors.validation'
  return 'users.errors.generic'
}

export async function createUserAction(
  input: CreateUserInput,
): Promise<{ inviteUrl: string } | { errorKey: string }> {
  try {
    const { roleId, roleIds, ...rest } = input
    // Prefer the new multi-id arrays; if a single roleId came in, fold it
    // into roleIds for the atomic create.
    const finalRoleIds = roleIds ?? (roleId ? [roleId] : undefined)
    const { inviteUrl } = await createUser({
      ...rest,
      ...(finalRoleIds && { roleIds: finalRoleIds }),
    })
    revalidatePath('/users')
    return { inviteUrl }
  } catch (err) {
    if (isRedirectSentinel(err)) throw err
    return { errorKey: mapUserError(err, { on409: 'users.errors.emailExists' }) }
  }
}

// bug-0190: these five pass-through read actions previously propagated
// any error from the underlying API call to their callers (the user
// view/create drawers). Because those callers use
// `Promise.all([...]).then().finally()` WITHOUT a `.catch()`, an API
// failure (403 after a mid-session permission loss, 404 on a
// concurrently-deleted user, network flake) surfaced as an unhandled
// promise rejection and left the drawer showing an empty state with
// no error indicator. Returning an empty array on failure preserves
// the drawer's "no data" rendering path — which is honest for a
// caller that can't read the data — and lets Sentry (via the API
// client) still capture the underlying failure.
export async function getUserRolesAction(userId: string): Promise<Role[]> {
  try {
    return await getUserRoles(userId)
  } catch {
    return []
  }
}

export async function getEffectivePermissionsAction(userId: string): Promise<Permission[]> {
  try {
    return await getEffectivePermissions(userId)
  } catch {
    return []
  }
}

export async function getUserDirectPermissionsAction(userId: string): Promise<Permission[]> {
  try {
    return await getUserDirectPermissions(userId)
  } catch {
    return []
  }
}

export async function setUserRolesAction(
  userId: string,
  roleIds: string[],
): Promise<{ ok: true } | { errorKey: string }> {
  try {
    await setUserRoles(userId, roleIds)
    revalidatePath('/users')
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('403')) return { errorKey: 'users.errors.forbidden' }
    if (message.includes('400')) return { errorKey: 'users.errors.rolesSetFailed' }
    return { errorKey: 'users.errors.rolesSetFailed' }
  }
}

export async function setUserDirectPermissionsAction(
  userId: string,
  permissionIds: string[],
): Promise<{ ok: true } | { errorKey: string }> {
  try {
    await setUserDirectPermissions(userId, permissionIds)
    revalidatePath('/users')
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('403')) return { errorKey: 'users.errors.forbidden' }
    if (message.includes('400')) return { errorKey: 'users.errors.directPermissionsSetFailed' }
    return { errorKey: 'users.errors.directPermissionsSetFailed' }
  }
}

// bug-0190: same pattern as the three read actions above — callers
// pull these in `Promise.all` chains without individual `.catch()`
// handlers, so an empty-array fallback keeps the drawer stable when
// an API call fails.
export async function getRolesAction(appId?: string): Promise<Role[]> {
  try {
    const result = await getRoles({ appId, pageSize: 200 })
    return result.items.map((r) => ({
      publicId: r.publicId,
      name: r.name,
      appId: r.app.publicId,
    }))
  } catch {
    return []
  }
}

export async function getAppPermissionsAction(
  appId: string,
): Promise<Array<{ publicId: string; name: string }>> {
  try {
    const result = await getPermissions({ appId, pageSize: 200 })
    return result.items.map((p) => ({ publicId: p.publicId, name: p.name }))
  } catch {
    return []
  }
}

// bug-0234 / bug-0221: previously this had no try/catch at all, so a raw
// Error (with the NestJS body attached) propagated to the drawer, which
// rendered `e.message` verbatim.
export async function updateUserAction(
  id: string,
  patch: Partial<User>,
): Promise<{ user: User } | { errorKey: string }> {
  try {
    const user = await updateUser(id, patch)
    revalidatePath('/users')
    return { user }
  } catch (err) {
    if (isRedirectSentinel(err)) throw err
    return { errorKey: mapUserError(err, { on403Own: 'users.errors.selfModify' }) }
  }
}

function mapActionError(err: unknown, map: { on400?: string; on403Own?: string; on403?: string }): string {
  const m = err instanceof Error ? err.message : ''
  if (map.on403Own && m.includes('403') && m.toLowerCase().includes('own')) return map.on403Own
  if (map.on400 && m.includes('400')) return map.on400
  if (map.on403 && m.includes('403')) return map.on403
  return 'users.errors.generic'
}

export async function resetPasswordAction(
  userId: string,
): Promise<{ resetUrl: string | null } | { errorKey: string }> {
  try {
    return await resetPassword(userId)
  } catch (err) {
    return { errorKey: mapActionError(err, { on400: 'users.errors.noPassword', on403: 'users.errors.forbidden' }) }
  }
}

export async function resendInvitationAction(
  userId: string,
): Promise<{ inviteUrl: string } | { errorKey: string }> {
  try {
    return await resendInvitation(userId)
  } catch (err) {
    return { errorKey: mapActionError(err, { on400: 'users.errors.notPending', on403: 'users.errors.forbidden' }) }
  }
}

export async function setUserStatusAction(
  userId: string,
  status: 'active' | 'inactive',
): Promise<{ ok: true } | { errorKey: string }> {
  try {
    await updateUser(userId, { status } as Partial<User>)
    revalidatePath('/users')
    return { ok: true }
  } catch (err) {
    return { errorKey: mapActionError(err, { on403Own: 'users.errors.selfDeactivate', on403: 'users.errors.forbidden' }) }
  }
}

export async function deleteUserAction(
  userId: string,
): Promise<{ ok: true } | { errorKey: string }> {
  try {
    await deleteUser(userId)
    revalidatePath('/users')
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('403') && message.toLowerCase().includes('own')) {
      return { errorKey: 'users.confirmDelete.selfDeleteError' }
    }
    if (message.includes('403')) return { errorKey: 'users.errors.forbidden' }
    return { errorKey: 'users.errors.generic' }
  }
}
