'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'

const AUTH_SERVER = process.env.NEXT_PUBLIC_AUTH_SERVER_URL ?? 'http://localhost:3000'

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
 */
export function SocialButtons({ providers, next }: { providers: string[]; next: string }) {
  const t = useTranslations('login')
  if (providers.length === 0) return null

  function start(provider: string) {
    // callbackURL returns the browser to whatever started the flow (usually
    // the /authorize URL); errorCallbackURL carries our classified code.
    const params = new URLSearchParams({
      provider,
      callbackURL: next || '/',
      errorCallbackURL: '/oauth-error',
    })
    window.location.href = `${AUTH_SERVER}/api/auth/sign-in/social?${params.toString()}`
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {providers.map((provider) => (
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
