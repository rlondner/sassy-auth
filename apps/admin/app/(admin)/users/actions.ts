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

export async function getUserRolesAction(userId: string): Promise<Role[]> {
  return getUserRoles(userId)
}

export async function getEffectivePermissionsAction(userId: string): Promise<Permission[]> {
  return getEffectivePermissions(userId)
}

export async function getUserDirectPermissionsAction(userId: string): Promise<Permission[]> {
  return getUserDirectPermissions(userId)
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

export async function getRolesAction(appId?: string): Promise<Role[]> {
  const result = await getRoles({ appId, pageSize: 200 })
  return result.items.map((r) => ({
    publicId: r.publicId,
    name: r.name,
    appId: r.app.publicId,
  }))
}

export async function getAppPermissionsAction(
  appId: string,
): Promise<Array<{ publicId: string; name: string }>> {
  const result = await getPermissions({ appId, pageSize: 200 })
  return result.items.map((p) => ({ publicId: p.publicId, name: p.name }))
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
