'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Button } from '@sassy-auth/ui'
import { signIn } from './actions'

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations('login')
  const [state, formAction, isPending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => signIn(formData),
    {},
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm text-[var(--foreground)]">{t('title')}</h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('subtitle')}</p>
        </div>

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

          {state?.error && (
            <p data-testid="login-error" className="text-label-md text-[var(--destructive)]">
              {state.error === 'invalidCredentials' ||
              state.error === 'inactive' ||
              state.error === 'serverUnavailable'
                ? t(`error.${state.error}`)
                : state.error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? '…' : t('submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
