import * as React from 'react'
import { cn } from '../lib/utils'

type StatusVariant = 'active' | 'pending' | 'inactive'

const styles: Record<StatusVariant, { dot: string }> = {
  active: { dot: 'bg-[#3525cd]' },
  pending: { dot: 'bg-[#d97706]' },
  inactive: { dot: 'bg-[#ba1a1a]' },
}

const variantStyles: Record<StatusVariant, { backgroundColor: string; color: string }> = {
  active: { backgroundColor: '#dce9ff', color: '#3525cd' },
  pending: { backgroundColor: '#fef3c7', color: '#92400e' },
  inactive: { backgroundColor: '#ffdad6', color: '#93000a' },
}

interface StatusChipProps {
  variant: StatusVariant
  label: string
  className?: string
}

export function StatusChip({ variant, label, className }: StatusChipProps) {
  const { dot } = styles[variant]
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-label-sm font-bold', className)}
      style={variantStyles[variant]}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}
