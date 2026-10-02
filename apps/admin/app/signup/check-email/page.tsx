import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { fetchAppInfo } from '@/lib/app-info'
import { CheckEmailCard } from './check-email-card'
import { VerifyCodeCard } from './verify-code-card'

export const dynamic = 'force-dynamic'

// Same "PUBLIC vs internal auth-server origin" split as app/login/page.tsx —
// this page fetches directly from the browser, so it needs the origin the
// browser can reach, not the one this Next.js process reaches internally.
const PUBLIC_AUTH_SERVER =
  process.env.PUBLIC_AUTH_SERVER_URL ?? process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string; clientId?: string }>
}) {
  const { email, next, clientId } = await searchParams
  const t = await getTranslations('signup.checkEmail')

  if (!email) {
    return <AuthCard title={t('title')} subtitle={t('missingEmail')} />
  }

  // Fail open to the classic link flow when clientId is missing or the app
  // lookup fails — matches fetchAppInfo's own fail-toward-'link' default.
  const emailVerificationMethod = clientId ? (await fetchAppInfo(clientId)).emailVerificationMethod : 'link'

  if (emailVerificationMethod === 'code') {
    return <VerifyCodeCard email={email} next={next ?? ''} authServerUrl={PUBLIC_AUTH_SERVER} />
  }

  return <CheckEmailCard email={email} next={next ?? ''} authServerUrl={PUBLIC_AUTH_SERVER} />
}
