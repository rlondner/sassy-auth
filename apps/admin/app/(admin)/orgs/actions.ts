'use server'

import { revalidatePath } from 'next/cache'
import { createOrg, updateOrg, deleteOrg, getOrgs } from '@/lib/api'
import type {
  OrgRow, CreateOrgPayload, UpdateOrgPayload, ListOrgsParams, ListOrgsResponse,
} from '@/lib/types'

type ErrorResult = { errorKey: string }

function mapError(message: string, kind: 'create' | 'update' | 'delete'): string {
  if (message.includes('409')) {
    if (kind === 'delete') return 'orgs.errors.hasDependents'
    return 'orgs.errors.nameExists'
  }
  if (message.includes('404')) {
    if (kind === 'create') return 'orgs.errors.appNotFound'
    return 'orgs.errors.generic'
  }
  if (message.includes('403')) {
    if (kind !== 'delete') return 'orgs.errors.platformProtected'
    return 'orgs.errors.forbidden'
  }
  return 'orgs.errors.generic'
}

export async function createOrgAction(
  input: CreateOrgPayload,
): Promise<{ org: OrgRow } | ErrorResult> {
  try {
    const org = await createOrg(input)
    revalidatePath('/orgs')
    return { org }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'create') }
  }
}

export async function updateOrgAction(
  publicId: string,
  patch: UpdateOrgPayload,
): Promise<{ org: OrgRow } | ErrorResult> {
  try {
    const org = await updateOrg(publicId, patch)
    revalidatePath('/orgs')
    return { org }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'update') }
  }
}

export async function deleteOrgAction(
  publicId: string,
): Promise<{ ok: true } | ErrorResult> {
  try {
    await deleteOrg(publicId)
    revalidatePath('/orgs')
    return { ok: true }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'delete') }
  }
}

export async function listOrgsAction(
  params: ListOrgsParams,
): Promise<ListOrgsResponse | ErrorResult> {
  try {
    return await getOrgs(params)
  } catch (err) {
    return {
      errorKey:
        err instanceof Error && err.message.includes('403')
          ? 'orgs.errors.forbidden'
          : 'orgs.errors.generic',
    }
  }
}
