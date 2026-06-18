import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import en from '@/messages/en.json'
import { OauthErrorActions } from './oauth-error-actions'

export const dynamic = 'force-dynamic'

const KNOWN_CODES = new Set(Object.keys(en.oauthError.codes))

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('oauthError')
  return { title: t('pageTitle') }
}

type SearchParams = Promise<{ code?: string; app?: string }>

export default async function OauthErrorPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const code = params.code
  const app = params.app
  const t = await getTranslations('oauthError')

  const isKnown = typeof code === 'string' && KNOWN_CODES.has(code)
  const heading = isKnown
    ? t(`codes.${code}.heading` as 'codes.invalid_request.heading')
    : t('fallbackHeading')
  const body = isKnown
    ? t(`codes.${code}.body` as 'codes.invalid_request.body')
    : t('fallbackBody')
  const hint = isKnown
    ? t(`codes.${code}.hint` as 'codes.invalid_request.hint')
    : t('fallbackHint')

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <h1 className="text-headline-sm text-[var(--foreground)]">{heading}</h1>
        <p className="mt-3 text-body-md text-[var(--foreground)]">{body}</p>
        <p className="mt-2 text-body-sm text-[var(--muted-foreground)]">{hint}</p>

        {app ? (
          <p className="mt-4 text-label-md text-[var(--muted-foreground)]">
            {t('appLabel')} <code className="font-mono">{app}</code>
          </p>
        ) : null}

        <OauthErrorActions code={isKnown ? code : 'unknown'} app={app} />
      </div>
    </div>
  )
}
