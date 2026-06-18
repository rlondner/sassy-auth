'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'

type Props = {
  code: string
  app: string | undefined
}

export function OauthErrorActions({ code, app }: Props) {
  const t = useTranslations('oauthError.actions')
  // Next.js inlines NEXT_PUBLIC_* env vars at build time, so reading via
  // process.env from a client component works without any extra wiring.
  const contactEmail = process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL

  const mailtoHref = contactEmail
    ? `mailto:${contactEmail}?subject=${encodeURIComponent(
        `SassyAuth authorization error: ${code}`,
      )}&body=${encodeURIComponent(
        [
          `I received the following authorization error from SassyAuth:`,
          ``,
          `Error code: ${code}`,
          app ? `Application ID: ${app}` : null,
          ``,
          `Please advise.`,
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
      )}`
    : null

  return (
    <div className="mt-6 flex flex-col gap-2">
      <Link href="/login" className="w-full">
        <Button className="w-full">{t('returnToSignIn')}</Button>
      </Link>
      {mailtoHref ? (
        <a href={mailtoHref} className="text-center text-label-md text-[var(--primary)] underline-offset-4 hover:underline">
          {t('contactAdministrator')}
        </a>
      ) : null}
    </div>
  )
}
