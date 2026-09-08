import { getTranslations } from 'next-intl/server'
import { AuthCard } from '@sassy-auth/ui'
import { ResetPasswordForm } from './reset-password-form'

export const dynamic = 'force-dynamic'

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
