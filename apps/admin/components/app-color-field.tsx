'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Input, Label } from '@sassy-auth/ui'

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/

interface Props {
  value: string | null
  onValueChange: (next: string | null) => void
  inputId: string
  label: string
  hint: string
}

export function AppColorField({ value, onValueChange, inputId, label, hint }: Props) {
  const t = useTranslations()
  const [draft, setDraft] = React.useState(value ?? '')
  const [invalid, setInvalid] = React.useState(false)

  React.useEffect(() => {
    setDraft(value ?? '')
    setInvalid(false)
  }, [value])

  function commitOnChange(next: string) {
    const trimmed = next.trim()
    if (trimmed === '') {
      setInvalid(false)
      onValueChange(null)
      return
    }
    if (!HEX_COLOR_PATTERN.test(trimmed)) {
      // Don't flag it as invalid while the user is still typing — only on blur.
      return
    }
    setInvalid(false)
    onValueChange(trimmed)
  }

  function commitOnBlur() {
    const trimmed = draft.trim()
    if (trimmed === '' || HEX_COLOR_PATTERN.test(trimmed)) {
      setInvalid(false)
      return
    }
    setInvalid(true)
  }

  return (
    <div>
      <Label htmlFor={inputId}>{label}</Label>
      <p className="mt-1 text-body-sm text-muted-foreground">{hint}</p>
      <div className="mt-2 flex items-center gap-2">
        <label
          className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded border border-border"
          style={{ backgroundColor: HEX_COLOR_PATTERN.test(draft) ? draft : '#ffffff' }}
        >
          <input
            type="color"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              setDraft(e.target.value)
              commitOnChange(e.target.value)
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <Input
          id={inputId}
          value={draft}
          placeholder="#0F172A"
          onChange={(e) => {
            setDraft(e.target.value)
            commitOnChange(e.target.value)
          }}
          onBlur={commitOnBlur}
          className="flex-1"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setDraft('')
              setInvalid(false)
              onValueChange(null)
            }}
            className="shrink-0 text-label-md text-primary hover:underline"
          >
            {t('apps.fields.resetColorToDefault')}
          </button>
        )}
      </div>
      {invalid && <p className="mt-1 text-label-md text-destructive">{t('apps.errors.invalidHexColor')}</p>}
    </div>
  )
}
