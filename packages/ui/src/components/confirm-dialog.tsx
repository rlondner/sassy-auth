'use client'

import * as React from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { cn } from '../lib/utils'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  variant?: 'default' | 'destructive'
  onConfirm: () => Promise<unknown> | unknown
  pending?: boolean
  error?: React.ReactNode
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  pending: pendingProp,
  error: errorProp,
}: ConfirmDialogProps) {
  const [internalPending, setInternalPending] = React.useState(false)
  const [internalError, setInternalError] = React.useState<React.ReactNode>(null)

  const pending = pendingProp ?? internalPending
  const error = errorProp ?? internalError

  React.useEffect(() => {
    if (!open) {
      setInternalPending(false)
      setInternalError(null)
    }
  }, [open])

  async function handleConfirm(e: React.MouseEvent) {
    e.preventDefault()
    setInternalError(null)
    setInternalPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed.'
      setInternalError(msg)
    } finally {
      setInternalPending(false)
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o) }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 shadow-lg focus:outline-none"
        >
          <AlertDialog.Title className="text-headline-sm">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-body-sm text-[var(--muted-foreground)]">{description}</div>
          </AlertDialog.Description>
          {error && (
            <div className="mt-3 rounded border border-[var(--destructive)]/40 bg-[var(--destructive)]/5 p-2 text-body-sm text-[var(--destructive)]">
              {error}
            </div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button
                type="button"
                disabled={pending}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-body-sm hover:bg-[var(--muted)] disabled:opacity-50"
              >
                {cancelLabel}
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={pending}
              className={cn(
                'rounded px-3 py-1.5 text-body-sm text-white disabled:opacity-50',
                variant === 'destructive' ? 'bg-[var(--destructive)]' : 'bg-[var(--primary)]',
              )}
            >
              {pending ? '…' : confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
