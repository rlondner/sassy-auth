'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'

const LABEL_KEY: Record<string, string> = {
  google: 'socialGoogle',
  microsoft: 'socialMicrosoft',
  apple: 'socialApple',
  stub: 'socialStub',
}

/**
 * Renders one button per provider the app has enabled. Empty list renders
 * nothing at all, so deployments with no providers configured see exactly
 * today's login page.
 *
 * `authServerUrl` is resolved server-side (see `app/login/page.tsx`) and
 * passed in as a prop rather than read from `NEXT_PUBLIC_*` here: a
 * `NEXT_PUBLIC_` value gets inlined into the JS bundle at BUILD time, so a
 * single build could never be deployed to more than one auth-server origin,
 * and any deployment that forgot to set it at build time would silently
 * point every social button at `http://localhost:3000`. Reading it at
 * request time on the server keeps it runtime-configurable.
 */
export function SocialButtons({
  providers,
  next,
  authServerUrl,
}: {
  providers: string[]
  next: string
  authServerUrl: string
}) {
  const t = useTranslations('login')
  const known = providers.filter((provider) => provider in LABEL_KEY)
  if (known.length === 0) return null

  // task-13 fix (found by the e2e acceptance gate — a real click on this
  // button had never been exercised against a real auth-server before):
  // BetterAuth's `/sign-in/social` endpoint is POST-only
  // (better-auth/dist/api/routes/sign-in.mjs:
  // `createAuthEndpoint("/sign-in/social", { method: "POST", ... })`). The
  // previous implementation did `window.location.href =
  // \`${authServerUrl}/api/auth/sign-in/social?${params}\`` — a plain
  // browser GET navigation — which 404s against a POST-only route (verified
  // live: `curl <authServerUrl>/api/auth/sign-in/social?provider=stub&...`
  // returns 404; the equivalent POST returns 200 with a JSON body
  // `{ url, redirect: true }`). The federated sign-in button could
  // therefore never have worked, for any provider, including
  // google/microsoft/apple — this was invisible to `social-buttons.test.tsx`
  // because jsdom's `window.location.href` setter only *records* the
  // assignment, it never performs a real navigation against a real server.
  // The fix: POST with `credentials: 'include'` (BetterAuth's response sets
  // a `better-auth.state` cookie the provider callback later reads back —
  // requires TRUSTED_ORIGINS on the auth-server to include this origin,
  // already true for the admin's own configured origin in every real
  // deployment), then navigate the browser to the `url` the response body
  // returns.
  async function start(provider: string) {
    // callbackURL returns the browser to whatever started the flow (usually
    // the /authorize URL); errorCallbackURL carries our classified code.
    try {
      const res = await fetch(`${authServerUrl}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider,
          callbackURL: next || '/',
          errorCallbackURL: '/oauth-error',
        }),
      })
      if (!res.ok) {
        // task-13 fix round 1, finding 3: every failure mode below used to
        // collapse to a bare redirect with zero signal. The status + origin
        // are safe to log (no credential/token/response body — the body
        // could contain a provider error description we don't want to
        // assume is safe) and are exactly what an operator needs to tell a
        // CORS/misconfiguration failure (opaque network error, see catch
        // below) from an auth-server-side rejection (a real HTTP status).
        console.error(`[social-buttons] sign-in/social returned ${res.status} for provider "${provider}" (${authServerUrl})`)
        window.location.href = '/oauth-error'
        return
      }
      const body = (await res.json()) as { url?: string }
      if (!body.url) {
        console.error(`[social-buttons] sign-in/social ${res.status} response for provider "${provider}" had no url`)
        window.location.href = '/oauth-error'
        return
      }
      window.location.href = body.url
    } catch (err) {
      // A thrown fetch here is almost always a network-level failure (CORS
      // rejection, DNS, connection refused) rather than an application
      // error — err.message from the browser's fetch implementation does
      // not carry credentials or response bodies, so it's safe to log.
      console.error(
        `[social-buttons] sign-in/social request failed for provider "${provider}" (${authServerUrl}): ${err instanceof Error ? err.message : String(err)}`,
      )
      window.location.href = '/oauth-error'
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {known.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="secondary"
            onClick={() => start(provider)}
          >
            {t(LABEL_KEY[provider] as 'socialGoogle')}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-body-sm text-[var(--muted-foreground)]">{t('socialDivider')}</span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
    </div>
  )
}
