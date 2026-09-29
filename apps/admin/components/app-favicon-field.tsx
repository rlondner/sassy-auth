'use client'

import { useTranslations } from 'next-intl'
import { APP_FAVICON_ALLOWED_MIME_TYPES, APP_FAVICON_MAX_BYTES } from '@sassy-auth/types'
import { AppImageField } from './app-image-field'

interface Props {
  value: string | null
  onValueChange: (next: string | null) => void
}

export function AppFaviconField({ value, onValueChange }: Props) {
  const t = useTranslations()
  return (
    <AppImageField
      value={value}
      onValueChange={onValueChange}
      inputId="appFavicon"
      label={t('apps.fields.favicon')}
      hint={t('apps.fields.faviconHint')}
      removeLabel={t('apps.fields.removeFavicon')}
      allowedMimeTypes={APP_FAVICON_ALLOWED_MIME_TYPES}
      maxBytes={APP_FAVICON_MAX_BYTES}
      invalidTypeErrorKey="apps.errors.faviconInvalidType"
      tooLargeErrorKey="apps.errors.faviconTooLarge"
    />
  )
}
