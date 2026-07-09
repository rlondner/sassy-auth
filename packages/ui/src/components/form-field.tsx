import * as React from 'react'
import { cn } from '../lib/utils'
import { Label } from './ui/label'
import { Input } from './ui/input'

interface FormFieldProps extends React.ComponentProps<typeof Input> {
  label: string
  error?: string
  hint?: string
  required?: boolean
}

export function FormField({ label, error, hint, required, className, id, ...props }: FormFieldProps) {
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
      <Label htmlFor={fieldId}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <Input id={fieldId} aria-invalid={!!error} aria-describedby={describedBy} {...props} />
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
}
