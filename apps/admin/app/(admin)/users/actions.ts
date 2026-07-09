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
} from '@/lib/api'
import type { CreateUserPayload, Permission, Role, User } from '@/lib/types'

interface CreateUserInput extends CreateUserPayload {
  /** Legacy single-role field — supported for callers not yet on roleIds. */
  roleId?: string
}

export async function createUserAction(
  input: CreateUserInput,
): Promise<{ inviteUrl: string } | { error: string }> {
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
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.includes('409') || message.includes('already')) {
      return { error: 'A user with this email already exists.' }
    }
    return { error: message }
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

export async function updateUserAction(id: string, patch: Partial<User>): Promise<User> {
  const result = await updateUser(id, patch)
  revalidatePath('/users')
  return result
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
