import * as React from 'react'
import { cn } from '../lib/utils'
import { Label } from './ui/label'
import { Input } from './ui/input'

interface FormFieldProps extends React.ComponentProps<typeof Input> {
  label: string
  error?: string
  hint?: string
  required?: boolean
  /**
   * `packages/ui` has no i18n of its own (see `AuthCard.logoAlt`), so
   * callers on localized pages must pass translated copy for the
   * password-visibility toggle's aria-label. English defaults keep
   * untranslated callers (and tests) working.
   */
  showPasswordLabel?: string
  hidePasswordLabel?: string
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  {
    label,
    error,
    hint,
    required,
    className,
    id,
    type,
    showPasswordLabel = 'Show password',
    hidePasswordLabel = 'Hide password',
    ...props
  },
  ref,
) {
  const [passwordVisible, setPasswordVisible] = React.useState(false)
  const isPassword = type === 'password'
  // bug-0170: previously the auto-generated id was
  // `label.toLowerCase().replace(/\s+/g, '-')`. Two fields with the
  // same label (e.g. "Name" for both create-app and create-org
  // dialogs mounted simultaneously) produced duplicate HTML ids,
  // which is invalid HTML and confuses screen readers / <label
  // for> associations. `React.useId()` guarantees a stable-per-
  // instance, unique-across-the-tree identifier — the label text
  // stays as-is, only the underlying id changes.
  const reactId = React.useId()
  const fieldId = id ?? reactId
  // bug-0203: link the hint to the input via aria-describedby when
  // no error is present. Screen readers now associate hint text
  // with the input; the error still takes precedence when shown.
  const hintId = hint ? `${fieldId}-hint` : undefined
  const errorId = error ? `${fieldId}-error` : undefined
  const describedBy = errorId ?? hintId
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-0.5">
        <Label htmlFor={fieldId}>{label}</Label>
        {required && (
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        )}
      </div>
      <div className="relative">
        <Input
          ref={ref}
          id={fieldId}
          type={isPassword && passwordVisible ? 'text' : type}
          required={required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={isPassword ? 'pr-10' : undefined}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? hidePasswordLabel : showPasswordLabel}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              {passwordVisible ? 'visibility_off' : 'visibility'}
            </span>
          </button>
        )}
      </div>
      {hint && !error && (
        <p id={hintId} className="text-label-md text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-label-md text-destructive">
          {error}
        </p>
      )}
    </div>
  )
})
