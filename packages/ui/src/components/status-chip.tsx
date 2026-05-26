import * as React from 'react'
import { cn } from '../lib/utils'

type StatusVariant = 'active' | 'pending' | 'inactive'

const textClass: Record<StatusVariant, string> = {
  active: 'text-[#3525cd]',
  pending: 'text-[#92400e]',
  inactive: 'text-[#93000a]',
}

const dotClass: Record<StatusVariant, string> = {
  active: 'bg-[#3525cd]',
  pending: 'bg-[#d97706]',
  inactive: 'bg-[#ba1a1a]',
}

const bgColor: Record<StatusVariant, string> = {
  active: '#dce9ff',
  pending: '#fef3c7',
  inactive: '#ffdad6',
}

interface StatusChipProps {
  variant: StatusVariant
  label: string
  className?: string
}

export function StatusChip({ variant, label, className }: StatusChipProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-label-sm font-bold', textClass[variant], className)}
      style={{ backgroundColor: bgColor[variant] }}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClass[variant])} />
      {label}
    </span>
  )
}
