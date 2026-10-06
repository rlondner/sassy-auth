'use client'

import * as React from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

interface CollapsibleSectionProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  className?: string
}

const CollapsibleSection = React.forwardRef<HTMLDivElement, CollapsibleSectionProps>(
  ({ title, open, onOpenChange, children, className }, ref) => (
    <CollapsiblePrimitive.Root
      ref={ref}
      open={open}
      onOpenChange={onOpenChange}
      className={cn('rounded border border-border', className)}
    >
      <CollapsiblePrimitive.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-label-md font-semibold"
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.currentTarget.click()
            }
          }}
        >
          {title}
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="space-y-4 px-3 pb-3 pt-1">
        {children}
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  ),
)
CollapsibleSection.displayName = 'CollapsibleSection'

export { CollapsibleSection }
