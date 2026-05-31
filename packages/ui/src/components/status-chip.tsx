import * as React from 'react'
import { cn } from '../lib/utils'

type StatusVariant = 'active' | 'pending' | 'inactive'

const styles: Record<StatusVariant, { wrap: string; dot: string }> = {
  active:   { wrap: 'bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800', dot: 'bg-green-500' },
  pending:  { wrap: 'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800', dot: 'bg-amber-500' },
  inactive: { wrap: 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',     dot: 'bg-slate-400' },
}

interface StatusChipProps {
  variant: StatusVariant
  label: string
  className?: string
}

export function StatusChip({ variant, label, className }: StatusChipProps) {
  const s = styles[variant]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm', s.wrap, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {label}
    </span>
  )
}
