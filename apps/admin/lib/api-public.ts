import type { InvitationInfo } from './types'

const BASE = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export async function validateInvitation(token: string): Promise<InvitationInfo> {
  const res = await fetch(`${BASE}/api/invitations/${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(`API error ${res.status}: /api/invitations/${token}`)
  return res.json()
}

export async function acceptInvitation(token: string, password: string): Promise<void> {
  const res = await fetch(`${BASE}/api/invitations/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(`API error ${res.status}: accept invitation`)
}
