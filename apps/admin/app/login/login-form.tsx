'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthCard, Button, FormField } from '@sassy-auth/ui'
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
    <AuthCard
      title={t('title')}
      subtitle={t('subtitle')}
      footer={
        clientId ? (
          <p className="text-center text-label-md text-muted-foreground">
            {t('signupPrompt')}{' '}
            <Link
              href={`/signup?client_id=${encodeURIComponent(clientId)}${next ? `&next=${encodeURIComponent(next)}` : ''}`}
              className="text-primary hover:underline"
            >
              {t('signupLink')}
            </Link>
          </p>
        ) : undefined
      }
    >
      <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />

        <FormField id="email" name="email" type="email" autoComplete="email" required label={t('email')} />

        <FormField
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          label={t('password')}
        />

        {'error' in state && state.error && (
          <p data-testid="login-error" className="text-label-md text-destructive">
            {state.error === 'invalidCredentials' ||
            state.error === 'inactive' ||
            state.error === 'unverified' ||
            state.error === 'serverUnavailable' ||
            state.error === 'tooManyRequests'
              ? t(`error.${state.error}`)
              : state.error}
          </p>
        )}

        <Link href="/forgot-password" className="self-end text-label-md text-primary hover:underline">
          {t('forgotPassword')}
        </Link>
        <Link
          href={next ? `/login/code?next=${encodeURIComponent(next)}` : '/login/code'}
          className="self-end text-label-md text-primary hover:underline"
        >
          {t('useCode')}
        </Link>

        <Button type="submit" className="w-full" loading={isPending}>
          {t('submit')}
        </Button>
      </form>
    </AuthCard>
  )
}
