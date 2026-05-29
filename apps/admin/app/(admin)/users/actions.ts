'use server'

import { revalidatePath } from 'next/cache'
import {
  createUser,
  assignRole,
  getUserRoles,
  getEffectivePermissions,
  getRoles,
  updateUser,
  deleteUser,
} from '@/lib/api'
import type { CreateUserPayload, Permission, Role, User } from '@/lib/types'

interface CreateUserInput extends CreateUserPayload {
  roleId?: string
}

export async function createUserAction(
  input: CreateUserInput,
): Promise<{ inviteUrl: string } | { error: string }> {
  try {
    const { roleId, ...payload } = input
    const { user, inviteUrl } = await createUser(payload)
    if (roleId) await assignRole(user.id, roleId)
    revalidatePath('/users')
    return { inviteUrl }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.includes('409') || message.includes('already')) return { error: 'A user with this email already exists.' }
    return { error: message }
  }
}

export async function getUserRolesAction(userId: string): Promise<Role[]> {
  return getUserRoles(userId)
}

export async function getEffectivePermissionsAction(userId: string): Promise<Permission[]> {
  return getEffectivePermissions(userId)
}

export async function getRolesAction(appId?: string): Promise<Role[]> {
  return getRoles(appId)
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
