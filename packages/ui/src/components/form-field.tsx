import * as React from 'react'
import { cn } from '../lib/utils'
import { Label } from './label'
import { Input, type InputProps } from './input'

interface FormFieldProps extends InputProps {
  label: string
  error?: string
  hint?: string
  required?: boolean
}

export function FormField({ label, error, hint, required, className, id, ...props }: FormFieldProps) {
  const fieldId = id ?? label.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required && <span className="ml-0.5 text-[var(--destructive)]">*</span>}
      </Label>
      <Input id={fieldId} aria-invalid={!!error} aria-describedby={error ? `${fieldId}-error` : undefined} {...props} />
      {hint && !error && <p className="text-label-md text-[var(--muted-foreground)]">{hint}</p>}
      {error && (
        <p id={`${fieldId}-error`} className="text-label-md text-[var(--destructive)]">
          {error}
        </p>
      )}
    </div>
  )
}
