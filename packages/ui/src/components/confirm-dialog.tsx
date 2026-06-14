'use client'

import * as React from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from './ui/alert-dialog'

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
  open, onOpenChange, title, description, confirmLabel, cancelLabel,
  variant = 'default', onConfirm, pending: pendingProp, error: errorProp,
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
    <AlertDialog open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="mt-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-body-sm text-destructive">
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            loading={pending}
            variant={variant}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
