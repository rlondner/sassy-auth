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
  const fieldId = id ?? label.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <Input id={fieldId} aria-invalid={!!error} aria-describedby={error ? `${fieldId}-error` : undefined} {...props} />
      {hint && !error && <p className="text-label-md text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${fieldId}-error`} className="text-label-md text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
