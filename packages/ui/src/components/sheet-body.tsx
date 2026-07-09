'use client'

import * as React from 'react'
import { cn } from '../lib/utils'

export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex-1 overflow-y-auto px-6 py-6', className)} {...props} />
}
