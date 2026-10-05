'use client'

import * as React from 'react'

const COOLDOWN_SECONDS = 30

export type ResendStatus = 'idle' | 'sending' | 'sent' | 'error'

/**
 * Shared by CheckEmailCard (post-signup) and the expired-link card on
 * /signup/verified — both resend a verification email by calling
 * BetterAuth's public send-verification-email endpoint directly from the
 * browser. callbackURL is computed at call time (not render time) so this
 * hook never touches `window` during server-side rendering.
 */
export function useResendVerificationEmail({
  email,
  authServerUrl,
}: {
  email: string
  authServerUrl: string
}) {
  const [cooldown, setCooldown] = React.useState(0)
  const [status, setStatus] = React.useState<ResendStatus>('idle')

  React.useEffect(() => {
    if (cooldown === 0) return
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  async function resend() {
    if (cooldown > 0 || status === 'sending') return
    setStatus('sending')
    try {
      const callbackURL = `${window.location.origin}/signup/verified?email=${encodeURIComponent(email)}`
      const res = await fetch(`${authServerUrl}/api/auth/send-verification-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, callbackURL }),
      })
      if (!res.ok) {
        setStatus('error')
        return
      }
      setStatus('sent')
      setCooldown(COOLDOWN_SECONDS)
    } catch {
      setStatus('error')
    }
  }

  return { resend, status, cooldown }
}
