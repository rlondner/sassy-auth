import type { InvitationInfo, PasswordPolicy } from './types'

const BASE = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export async function validateInvitation(token: string): Promise<InvitationInfo> {
  const res = await fetch(`${BASE}/api/invitations/${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(`API error ${res.status}: fetching invitation`)
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

export async function getPasswordPolicyForResetToken(token: string): Promise<PasswordPolicy> {
  const res = await fetch(`${BASE}/api/password-policy?resetToken=${encodeURIComponent(token)}`)
  if (!res.ok) throw new Error(`API error ${res.status}: fetching password policy`)
  const body = (await res.json()) as { passwordPolicy: PasswordPolicy }
  return body.passwordPolicy
}
