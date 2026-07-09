'use server'

import { revalidatePath } from 'next/cache'
import {
  createRole, updateRole, deleteRole, getRoles, getRole,
} from '@/lib/api'
import type {
  RoleRow, RoleDetail,
  CreateRolePayload, UpdateRolePayload,
  ListRolesParams, ListRolesResponse,
} from '@/lib/types'

type ErrorResult = { errorKey: string }

function mapError(message: string, kind: 'create' | 'update' | 'delete'): string {
  if (message.includes('409')) {
    if (kind === 'delete') return 'roles.errors.inUse'
    return 'roles.errors.nameExists'
  }
  if (message.includes('404')) {
    if (kind === 'create') return 'roles.errors.appNotFound'
    return 'roles.errors.generic'
  }
  if (message.includes('403')) return 'roles.errors.forbidden'
  if (message.includes('400')) return 'roles.errors.invalidInput'
  return 'roles.errors.generic'
}

export async function createRoleAction(
  input: CreateRolePayload,
): Promise<{ role: RoleDetail } | ErrorResult> {
  try {
    const role = await createRole(input)
    revalidatePath('/roles')
    return { role }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'create') }
  }
}

export async function updateRoleAction(
  publicId: string,
  patch: UpdateRolePayload,
): Promise<{ role: RoleDetail } | ErrorResult> {
  try {
    const role = await updateRole(publicId, patch)
    revalidatePath('/roles')
    return { role }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'update') }
  }
}

export async function deleteRoleAction(
  publicId: string,
): Promise<{ ok: true } | ErrorResult> {
  try {
    await deleteRole(publicId)
    revalidatePath('/roles')
    return { ok: true }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'delete') }
  }
}

export async function listRolesAction(
  params: ListRolesParams,
): Promise<ListRolesResponse | ErrorResult> {
  try {
    return await getRoles(params)
  } catch (err) {
    return {
      errorKey:
        err instanceof Error && err.message.includes('403')
          ? 'roles.errors.forbidden'
          : 'roles.errors.generic',
    }
  }
}

export async function getRoleAction(
  publicId: string,
): Promise<RoleDetail | ErrorResult> {
  try {
    return await getRole(publicId)
  } catch (err) {
    return {
      errorKey:
        err instanceof Error && err.message.includes('403')
          ? 'roles.errors.forbidden'
          : 'roles.errors.generic',
    }
  }
}

// Fetch permissions scoped to a specific app (used by the role drawers'
// permission-row dropdowns). Filters by app so the dropdown only offers
// permissions that the role can actually hold.
export async function listAppPermissionsAction(
  appPublicId: string,
): Promise<Array<{ publicId: string; name: string }> | ErrorResult> {
  try {
    const { getPermissions } = await import('@/lib/api')
    const result = await getPermissions({ appId: appPublicId, pageSize: 200 })
    return result.items.map((p) => ({ publicId: p.publicId, name: p.name }))
  } catch (err) {
    return {
      errorKey:
        err instanceof Error && err.message.includes('403')
          ? 'roles.errors.forbidden'
          : 'roles.errors.generic',
    }
  }
}
