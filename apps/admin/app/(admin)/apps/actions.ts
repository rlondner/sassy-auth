'use server'

import { revalidatePath } from 'next/cache'
import { createApp, updateApp, deleteApp, getApps } from '@/lib/api'
import type {
  App, CreateAppPayload, UpdateAppPayload, ListAppsParams, ListAppsResponse,
} from '@/lib/types'

type ErrorResult = { errorKey: string }

function mapError(message: string, kind: 'create' | 'update' | 'delete'): string {
  if (message.includes('409')) {
    if (kind === 'delete') return 'apps.errors.hasDependents'
    return 'apps.errors.nameExists'
  }
  if (message.includes('403')) {
    if (kind !== 'delete') return 'apps.errors.platformProtected'
    return 'apps.errors.forbidden'
  }
  if (message.includes('400')) {
    return 'apps.errors.urlInvalid'
  }
  return 'apps.errors.generic'
}

export async function createAppAction(
  input: CreateAppPayload,
): Promise<{ app: App } | ErrorResult> {
  try {
    const app = await createApp(input)
    revalidatePath('/apps')
    return { app }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'create') }
  }
}

export async function updateAppAction(
  publicId: string,
  patch: UpdateAppPayload,
): Promise<{ app: App } | ErrorResult> {
  try {
    const app = await updateApp(publicId, patch)
    revalidatePath('/apps')
    return { app }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'update') }
  }
}

export async function deleteAppAction(
  publicId: string,
): Promise<{ ok: true } | ErrorResult> {
  try {
    await deleteApp(publicId)
    revalidatePath('/apps')
    return { ok: true }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'delete') }
  }
}

// Used by the client table for debounced search + pagination re-fetches.
export async function listAppsAction(
  params: ListAppsParams,
): Promise<ListAppsResponse | ErrorResult> {
  try {
    return await getApps(params)
  } catch (err) {
    return {
      errorKey:
        err instanceof Error && err.message.includes('403')
          ? 'apps.errors.forbidden'
          : 'apps.errors.generic',
    }
  }
}
