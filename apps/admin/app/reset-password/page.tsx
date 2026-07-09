import { getTranslations } from 'next-intl/server'
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
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
        <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
          <p className="text-body-md text-[var(--foreground)]">{t('invalidToken')}</p>
        </div>
      </div>
    )
  }
  return <ResetPasswordForm token={token} />
}
