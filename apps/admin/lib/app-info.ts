import 'server-only'
import type { PasswordPolicy } from './types'
import { getForwardedClientIpHeader } from './forward-client-ip'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export async function fetchAppInfo(
  clientId: string,
): Promise<{
  name: string | null; hasDefaultOrg: boolean; passwordPolicy: PasswordPolicy | null; logo: string | null;
  favicon: string | null;
  privacyPolicyUrl: string | null; termsUrl: string | null; gdprUrl: string | null; gdprRequired: boolean;
  emailVerificationMethod: 'link' | 'code';
}> {
  try {
    const forwardedIp = await getForwardedClientIpHeader()
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
      headers: { ...forwardedIp },
    })
    if (!res.ok) {
      // Fail toward hasDefaultOrg: false, not true: a Company name field shown
      // but ignored by the server is harmless, whereas defaulting to true could
      // hide a required field and produce a signup-blocking dead end. Same
      // fail-safe reasoning for emailVerificationMethod: 'link' is the
      // existing, always-supported flow.
      return {
        name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null, favicon: null,
        privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
        emailVerificationMethod: 'link',
      }
    }
    const body = (await res.json()) as {
      name?: string; hasDefaultOrg?: boolean; passwordPolicy?: PasswordPolicy; logo?: string | null; favicon?: string | null;
      privacyPolicyUrl?: string | null; termsUrl?: string | null; gdprUrl?: string | null; gdprRequired?: boolean;
      emailVerificationMethod?: 'link' | 'code';
    }
    return {
      name: typeof body.name === 'string' ? body.name : null,
      hasDefaultOrg: body.hasDefaultOrg === true,
      passwordPolicy: body.passwordPolicy ?? null,
      logo: typeof body.logo === 'string' ? body.logo : null,
      favicon: typeof body.favicon === 'string' ? body.favicon : null,
      privacyPolicyUrl: typeof body.privacyPolicyUrl === 'string' ? body.privacyPolicyUrl : null,
      termsUrl: typeof body.termsUrl === 'string' ? body.termsUrl : null,
      gdprUrl: typeof body.gdprUrl === 'string' ? body.gdprUrl : null,
      gdprRequired: body.gdprRequired === true,
      emailVerificationMethod: body.emailVerificationMethod === 'code' ? 'code' : 'link',
    }
  } catch {
    // Same reasoning as the !res.ok branch above: fail toward false/link.
    return {
      name: null, hasDefaultOrg: false, passwordPolicy: null, logo: null, favicon: null,
      privacyPolicyUrl: null, termsUrl: null, gdprUrl: null, gdprRequired: false,
      emailVerificationMethod: 'link',
    }
  }
}
