'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Label } from '@sassy-auth/ui'
import { APP_LOGO_ALLOWED_MIME_TYPES, APP_LOGO_MAX_BYTES } from '@sassy-auth/types'
import { readFileAsDataUri } from '@/lib/read-file-as-data-uri'

interface Props {
  value: string | null
  onValueChange: (next: string | null) => void
}

export function AppLogoField({ value, onValueChange }: Props) {
  const t = useTranslations()
  const [errorKey, setErrorKey] = React.useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!(APP_LOGO_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      setErrorKey('apps.errors.logoInvalidType')
      return
    }
    if (file.size > APP_LOGO_MAX_BYTES) {
      setErrorKey('apps.errors.logoTooLarge')
      return
    }
    setErrorKey(null)
    const dataUri = await readFileAsDataUri(file)
    onValueChange(dataUri)
  }

  function handleRemove() {
    setErrorKey(null)
    onValueChange(null)
  }

  return (
    <div>
      <Label htmlFor="appLogo">{t('apps.fields.logo')}</Label>
      <p className="mt-1 text-body-sm text-muted-foreground">{t('apps.fields.logoHint')}</p>
      <div className="mt-2 flex items-center gap-3">
        {value && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={t('apps.fields.logo')}
            className="h-10 w-10 rounded border border-border object-contain"
          />
        )}
        <input
          id="appLogo"
          type="file"
          accept={(APP_LOGO_ALLOWED_MIME_TYPES as readonly string[]).join(',')}
          onChange={handleFileChange}
          className="block text-body-sm"
        />
        {value && (
          <button
            type="button"
            aria-label={t('apps.fields.removeLogo')}
            onClick={handleRemove}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {errorKey && (
        <p role="alert" className="mt-1 text-body-sm text-destructive">
          {t(errorKey)}
        </p>
      )}
    </div>
  )
}
