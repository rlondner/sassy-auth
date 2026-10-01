'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Label } from '@sassy-auth/ui'
import { readFileAsDataUri } from '@/lib/read-file-as-data-uri'

interface Props {
  value: string | null
  onValueChange: (next: string | null) => void
  inputId: string
  label: string
  hint: string
  removeLabel: string
  allowedMimeTypes: readonly string[]
  maxBytes: number
  invalidTypeErrorKey: string
  tooLargeErrorKey: string
}

export function AppImageField({
  value, onValueChange, inputId, label, hint, removeLabel, allowedMimeTypes, maxBytes, invalidTypeErrorKey, tooLargeErrorKey,
}: Props) {
  const t = useTranslations()
  const [errorKey, setErrorKey] = React.useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!allowedMimeTypes.includes(file.type)) {
      setErrorKey(invalidTypeErrorKey)
      return
    }
    if (file.size > maxBytes) {
      setErrorKey(tooLargeErrorKey)
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
      <Label htmlFor={inputId}>{label}</Label>
      <p className="mt-1 text-body-sm text-muted-foreground">{hint}</p>
      <div className="mt-2 flex items-center gap-3">
        {value && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={label}
            className="h-10 w-10 rounded border border-border object-contain"
          />
        )}
        <input
          id={inputId}
          type="file"
          accept={allowedMimeTypes.join(',')}
          onChange={handleFileChange}
          className="block text-body-sm"
        />
        {value && (
          <button
            type="button"
            aria-label={removeLabel}
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
