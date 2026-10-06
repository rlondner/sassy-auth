const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export interface AppBranding {
  logo: string | null; favicon: string | null;
  pageLightBackgroundColor: string | null; pageDarkBackgroundColor: string | null;
  cardLightBackgroundColor: string | null; cardDarkBackgroundColor: string | null;
}

const FAILSAFE: AppBranding = {
  logo: null, favicon: null,
  pageLightBackgroundColor: null, pageDarkBackgroundColor: null,
  cardLightBackgroundColor: null, cardDarkBackgroundColor: null,
}

/**
 * Branding (logo/favicon/background colors) for an app identified by
 * client_id, for pages that have only a client_id and no richer existing
 * app-info fetch (check-email, verified, login/code, two-factor,
 * two-factor-prompt, forgot-password). Wraps GET /api/social-providers,
 * which already resolves this exact shape for the login page (see
 * SocialService.getBrandingForApp) — reused here rather than adding a new
 * endpoint. A missing clientId or any fetch failure fails open to all-null,
 * matching every other per-app branding lookup in this codebase.
 */
export async function fetchAppBranding(clientId: string | null): Promise<AppBranding> {
  if (!clientId) return FAILSAFE
  try {
    const res = await fetch(`${AUTH_SERVER}/api/social-providers?client_id=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return FAILSAFE
    const body = (await res.json()) as {
      logo?: unknown; favicon?: unknown;
      pageLightBackgroundColor?: unknown; pageDarkBackgroundColor?: unknown;
      cardLightBackgroundColor?: unknown; cardDarkBackgroundColor?: unknown;
    }
    return {
      logo: typeof body.logo === 'string' ? body.logo : null,
      favicon: typeof body.favicon === 'string' ? body.favicon : null,
      pageLightBackgroundColor: typeof body.pageLightBackgroundColor === 'string' ? body.pageLightBackgroundColor : null,
      pageDarkBackgroundColor: typeof body.pageDarkBackgroundColor === 'string' ? body.pageDarkBackgroundColor : null,
      cardLightBackgroundColor: typeof body.cardLightBackgroundColor === 'string' ? body.cardLightBackgroundColor : null,
      cardDarkBackgroundColor: typeof body.cardDarkBackgroundColor === 'string' ? body.cardDarkBackgroundColor : null,
    }
  } catch {
    return FAILSAFE
  }
}
