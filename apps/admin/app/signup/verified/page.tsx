import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export default async function SignupVerifiedPage() {
  const t = await getTranslations()

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm text-center">
        <div className="mb-4 flex justify-center">
          <span className="material-symbols-outlined text-[48px] text-[var(--primary)]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
        <h1 className="text-headline-sm text-[var(--foreground)]">{t('signup.verified.title')}</h1>
        <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('signup.verified.subtitle')}</p>
        <div className="mt-4">
          <Link href="/login" className="text-label-md text-[var(--primary)] hover:underline">
            {t('signup.verified.continueToLogin')}
          </Link>
        </div>
      </div>
    </div>
  )
}
