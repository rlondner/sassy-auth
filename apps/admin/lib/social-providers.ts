const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

/**
 * Ask the auth-server which provider buttons this app shows. `next` is the
 * authorize URL the user was bounced from; its client_id names the app.
 * Any failure yields an empty list — the password form must still render.
 */
export async function fetchSocialProviders(next: string): Promise<string[]> {
  let clientId: string | null = null
  try {
    clientId = new URL(next, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    clientId = null
  }

  const query = clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''
  try {
    const res = await fetch(`${AUTH_SERVER}/api/social-providers${query}`, { cache: 'no-store' })
    if (!res.ok) return []
    const body = (await res.json()) as { providers?: unknown }
    return Array.isArray(body.providers) ? (body.providers as string[]) : []
  } catch {
    return []
  }
}
