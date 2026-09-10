import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { CheckEmailCard } from './check-email-card'

export const dynamic = 'force-dynamic'

// Same "PUBLIC vs internal auth-server origin" split as app/login/page.tsx —
// this page fetches directly from the browser, so it needs the origin the
// browser can reach, not the one this Next.js process reaches internally.
const PUBLIC_AUTH_SERVER =
  process.env.PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>
}) {
  const { email, next } = await searchParams
  const t = await getTranslations('signup.checkEmail')

  if (!email) {
    return <AuthCard title={t('title')} subtitle={t('missingEmail')} />
  }

  return <CheckEmailCard email={email} next={next ?? ''} authServerUrl={PUBLIC_AUTH_SERVER} />
}
