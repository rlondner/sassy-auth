'use server'

import { revalidatePath } from 'next/cache'
import {
  createPermission, updatePermission, deletePermission, getPermissions, getPermission,
} from '@/lib/api'
import type {
  PermissionRow, PermissionDetail,
  CreatePermissionPayload, UpdatePermissionPayload,
  ListPermissionsParams, ListPermissionsResponse,
} from '@/lib/types'

type ErrorResult = { errorKey: string }

function mapError(message: string, kind: 'create' | 'update' | 'delete'): string {
  if (message.includes('409')) {
    if (kind === 'delete') return 'permissions.errors.inUse'
    return 'permissions.errors.nameExists'
  }
  if (message.includes('404')) {
    if (kind === 'create') return 'permissions.errors.appNotFound'
    return 'permissions.errors.generic'
  }
  if (message.includes('403')) {
    if (kind !== 'delete') return 'permissions.errors.platformProtected'
    return 'permissions.errors.forbidden'
  }
  if (message.includes('400')) return 'permissions.errors.nameInvalid'
  return 'permissions.errors.generic'
}

export async function createPermissionAction(
  input: CreatePermissionPayload,
): Promise<{ permission: PermissionRow } | ErrorResult> {
  try {
    const permission = await createPermission(input)
    revalidatePath('/permissions')
    return { permission }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'create') }
  }
}

export async function updatePermissionAction(
  publicId: string,
  patch: UpdatePermissionPayload,
): Promise<{ permission: PermissionRow } | ErrorResult> {
  try {
    const permission = await updatePermission(publicId, patch)
    revalidatePath('/permissions')
    return { permission }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'update') }
  }
}

export async function deletePermissionAction(
  publicId: string,
): Promise<{ ok: true } | ErrorResult> {
  try {
    await deletePermission(publicId)
    revalidatePath('/permissions')
    return { ok: true }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'delete') }
  }
}

export async function listPermissionsAction(
  params: ListPermissionsParams,
): Promise<ListPermissionsResponse | ErrorResult> {
  try {
    return await getPermissions(params)
  } catch (err) {
    return {
      errorKey:
        err instanceof Error && err.message.includes('403')
          ? 'permissions.errors.forbidden'
          : 'permissions.errors.generic',
    }
  }
}

export async function getPermissionAction(
  publicId: string,
): Promise<PermissionDetail | ErrorResult> {
  try {
    return await getPermission(publicId)
  } catch (err) {
    return {
      errorKey:
        err instanceof Error && err.message.includes('403')
          ? 'permissions.errors.forbidden'
          : 'permissions.errors.generic',
    }
  }
}
