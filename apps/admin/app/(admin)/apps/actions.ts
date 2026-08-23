'use server'

import { revalidatePath } from 'next/cache'
import { createApp, updateApp, deleteApp, getApps, getSocialProviders, setSocialProviders } from '@/lib/api'
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
    return 'apps.errors.urlInsecure'
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

// Used by the edit drawer to populate the social sign-in checkbox group.
// Failures fall back to an empty list rather than surfacing an error — the
// rest of the drawer (name/url/2FA fields) must still be usable even if the
// social-providers call fails.
export async function getSocialProvidersAction(
  clientId: string,
): Promise<{ providers: string[] } | ErrorResult> {
  try {
    return { providers: await getSocialProviders(clientId) }
  } catch {
    return { errorKey: 'apps.errors.generic' }
  }
}

export async function updateSocialProvidersAction(
  clientId: string,
  providers: string[],
): Promise<{ providers: string[] } | ErrorResult> {
  try {
    return { providers: await setSocialProviders(clientId, providers) }
  } catch (err) {
    return { errorKey: mapError(err instanceof Error ? err.message : '', 'update') }
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
