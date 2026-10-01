const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

/**
 * Ask the auth-server which provider buttons this app shows, and what
 * branding (name/logo/favicon, if any) to render on the login card. `next`
 * is the authorize URL the user was bounced from; its client_id names the
 * app. Any failure yields an empty provider list and no branding — the
 * password form must still render.
 */
export async function fetchSocialProviders(next: string): Promise<{
  providers: string[]; logo: string | null; name: string | null; favicon: string | null
}> {
  let clientId: string | null = null
  try {
    clientId = new URL(next, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    clientId = null
  }

  const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''
  try {
    const res = await fetch(`${AUTH_SERVER}/api/social-providers${query}`, { cache: 'no-store' })
    if (!res.ok) return { providers: [], logo: null, name: null, favicon: null }
    const body = (await res.json()) as { providers?: unknown; logo?: unknown; name?: unknown; favicon?: unknown }
    return {
      providers: Array.isArray(body.providers) ? (body.providers as string[]) : [],
      logo: typeof body.logo === 'string' ? body.logo : null,
      name: typeof body.name === 'string' ? body.name : null,
      favicon: typeof body.favicon === 'string' ? body.favicon : null,
    }
  } catch {
    return { providers: [], logo: null, name: null, favicon: null }
  }
}
