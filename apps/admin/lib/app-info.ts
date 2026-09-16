import 'server-only'
import type { PasswordPolicy } from './types'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export async function fetchAppInfo(
  clientId: string,
): Promise<{ name: string | null; hasDefaultOrg: boolean; passwordPolicy: PasswordPolicy | null; logo: string | null }> {
  try {
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) {
      // Fail toward hasDefaultOrg: false, not true: a Company name field shown
      // but ignored by the server is harmless, whereas defaulting to true could
      // hide a required field and produce a signup-blocking dead end.
      return { name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null }
    }
    const body = (await res.json()) as { name?: string; hasDefaultOrg?: boolean; passwordPolicy?: PasswordPolicy; logo?: string | null }
    return {
      name: typeof body.name === 'string' ? body.name : null,
      hasDefaultOrg: body.hasDefaultOrg === true,
      passwordPolicy: body.passwordPolicy ?? null,
      logo: typeof body.logo === 'string' ? body.logo : null,
    }
  } catch {
    // Same reasoning as the !res.ok branch above: fail toward false.
    return { name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null }
  }
}
