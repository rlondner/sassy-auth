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

  function start(provider: string) {
    // callbackURL returns the browser to whatever started the flow (usually
    // the /authorize URL); errorCallbackURL carries our classified code.
    const params = new URLSearchParams({
      provider,
      callbackURL: next || '/',
      errorCallbackURL: '/oauth-error',
    })
    window.location.href = `${authServerUrl}/api/auth/sign-in/social?${params.toString()}`
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
