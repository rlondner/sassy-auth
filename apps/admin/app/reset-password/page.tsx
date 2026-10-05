import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { getPasswordPolicyForResetToken } from '@/lib/api-public'
import { ResetPasswordForm } from './reset-password-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}): Promise<Metadata> {
  const { token } = await searchParams
  if (!token) return {}
  try {
    const { favicon } = await getPasswordPolicyForResetToken(token)
    return favicon ? { icons: { icon: favicon } } : {}
  } catch {
    // Same fail-open stance as the page body below: an unreachable
    // auth-server must not break metadata generation.
    return {}
  }
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const t = await getTranslations('resetPassword')
  if (!token) {
    return (
      <AuthCard className="max-w-md">
        <p className="text-body-md text-foreground">{t('invalidToken')}</p>
      </AuthCard>
    )
  }
  return <ResetPasswordForm token={token} />
}
