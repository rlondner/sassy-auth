'use client'

import { useTranslations } from 'next-intl'
import { APP_LOGO_ALLOWED_MIME_TYPES, APP_LOGO_MAX_BYTES } from '@sassy-auth/types'
import { AppImageField } from './app-image-field'

interface Props {
  value: string | null
  onValueChange: (next: string | null) => void
}

export function AppLogoField({ value, onValueChange }: Props) {
  const t = useTranslations()
  return (
    <AppImageField
      value={value}
      onValueChange={onValueChange}
      inputId="appLogo"
      label={t('apps.fields.logo')}
      hint={t('apps.fields.logoHint')}
      removeLabel={t('apps.fields.removeLogo')}
      allowedMimeTypes={APP_LOGO_ALLOWED_MIME_TYPES}
      maxBytes={APP_LOGO_MAX_BYTES}
      invalidTypeErrorKey="apps.errors.logoInvalidType"
      tooLargeErrorKey="apps.errors.logoTooLarge"
    />
  )
}
