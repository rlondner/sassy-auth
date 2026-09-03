'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@sassy-auth/ui'
import { signIn } from './actions'
import { SocialButtons } from './social-buttons'

/**
 * `next` may be a relative or absolute authorize URL carrying `client_id` —
 * the same shape `applyPerAppTrustCookie` (app/login/actions.ts) already
 * parses for trust-day lookups. A placeholder base lets a relative `next`
 * parse without throwing.
 */
function clientIdFromNext(next: string): string | null {
  if (!next) return null
  try {
    return new URL(next, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    return null
  }
}

export function LoginForm({
  next,
  providers = [],
  authServerUrl,
}: {
  next: string
  providers?: string[]
  authServerUrl: string
}) {
  const t = useTranslations('login')
  const router = useRouter()
  const clientId = clientIdFromNext(next)

  const [state, formAction, isPending] = useActionState(
    async (
      _prev: { error?: string } | { twoFactor: true },
      formData: FormData,
    ): Promise<{ error?: string } | { twoFactor: true }> => {
      formData.set('next', next)
      const result = await signIn(formData)
      if ('twoFactor' in result && result.twoFactor) {
        router.push(`/login/two-factor${next ? `?next=${encodeURIComponent(next)}` : ''}`)
      }
      return result
    },
    {} as { error?: string } | { twoFactor: true },
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm text-[var(--foreground)]">{t('title')}</h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('subtitle')}</p>
        </div>

        <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />

          <div className="flex flex-col gap-1.5">
            <label className="text-label-md font-semibold" htmlFor="email">{t('email')}</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-label-md font-semibold" htmlFor="password">{t('password')}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>

          {'error' in state && state.error && (
            <p data-testid="login-error" className="text-label-md text-[var(--destructive)]">
              {state.error === 'invalidCredentials' ||
              state.error === 'inactive' ||
              state.error === 'serverUnavailable' ||
              state.error === 'tooManyRequests'
                ? t(`error.${state.error}`)
                : state.error}
            </p>
          )}

          <Link href="/forgot-password" className="text-label-md text-[var(--primary)] hover:underline self-end">
            {t('forgotPassword')}
          </Link>
          <Link
            href={next ? `/login/code?next=${encodeURIComponent(next)}` : '/login/code'}
            className="text-label-md text-[var(--primary)] hover:underline self-end"
          >
            {t('useCode')}
          </Link>

          <Button type="submit" className="w-full" loading={isPending}>
            {t('submit')}
          </Button>
        </form>

        {clientId && (
          <p className="mt-4 text-center text-label-md text-[var(--muted-foreground)]">
            {t('signupPrompt')}{' '}
            <Link
              href={`/signup?client_id=${encodeURIComponent(clientId)}${next ? `&next=${encodeURIComponent(next)}` : ''}`}
              className="text-[var(--primary)] hover:underline"
            >
              {t('signupLink')}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
