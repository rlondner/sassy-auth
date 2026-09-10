import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import type { PasswordPolicy } from '@/lib/types'
import { SignupForm } from './signup-form'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'https://localhost:3010'

export const dynamic = 'force-dynamic'

export async function fetchAppInfo(
  clientId: string,
): Promise<{ name: string | null; hasDefaultOrg: boolean; passwordPolicy: PasswordPolicy | null }> {
  try {
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) {
      // Fail toward hasDefaultOrg: false, not true: a Company name field shown
      // but ignored by the server is harmless, whereas defaulting to true could
      // hide a required field and produce a signup-blocking dead end.
      return { name: null, hasDefaultOrg: false, passwordPolicy: null }
    }
    const body = (await res.json()) as { name?: string; hasDefaultOrg?: boolean; passwordPolicy?: PasswordPolicy }
    return {
      name: typeof body.name === 'string' ? body.name : null,
      hasDefaultOrg: body.hasDefaultOrg === true,
      passwordPolicy: body.passwordPolicy ?? null,
    }
  } catch {
    // Same reasoning as the !res.ok branch above: fail toward false.
    return { name: null, hasDefaultOrg: false, passwordPolicy: null }
  }
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; next?: string }>
}) {
  const { client_id: clientId, next } = await searchParams
  const t = await getTranslations()

  if (!clientId) {
    return (
      <AuthCard
        className="max-w-md"
        icon={<span className="material-symbols-outlined text-[48px] text-destructive">error</span>}
      >
        <p className="text-center text-body-md text-foreground">{t('signup.invalidLink')}</p>
      </AuthCard>
    )
  }

  const { name: appName, hasDefaultOrg, passwordPolicy } = await fetchAppInfo(clientId)
  const nextSafe = next ?? ''

  return (
    <AuthCard
      title={appName ? t('signup.titleWithApp', { appName }) : t('signup.title')}
      subtitle={t('signup.subtitle')}
      footer={
        <Link
          href={nextSafe ? `/login?next=${encodeURIComponent(nextSafe)}` : '/login'}
          className="text-label-md text-primary hover:underline"
        >
          {t('signup.backToLogin')}
        </Link>
      }
    >
      <SignupForm clientId={clientId} next={nextSafe} hasDefaultOrg={hasDefaultOrg} passwordPolicy={passwordPolicy} />
    </AuthCard>
  )
}
