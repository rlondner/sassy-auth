import type { InvitationInfo, PasswordPolicy } from './types'

// This module's functions are called directly from CLIENT components
// (accept-invite-form.tsx, reset-password-form.tsx), so the fetch target
// must be readable in the browser bundle. AUTH_SERVER_URL and
// PUBLIC_AUTH_SERVER_URL (see apps/admin/app/login/page.tsx) are plain
// server-only env vars — Next.js never inlines them into client code, so
// reading them here would always be undefined in the browser and silently
// fall back to localhost in every real deployment. Only NEXT_PUBLIC_-
// prefixed vars are statically inlined at build time, hence the separate var.
const BASE = process.env.NEXT_PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

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
