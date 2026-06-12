'use client'

import * as React from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  buttonVariants, cn,
} from '@sassy-auth/ui'

interface DeleteAlertDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => Promise<void>
  error?: string | null
}

export function DeleteAlertDialog({
  open, onOpenChange, title, description, confirmLabel, cancelLabel, onConfirm, error,
}: DeleteAlertDialogProps) {
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (!open) setPending(false)
  }, [open])

  async function handleConfirm(e: React.MouseEvent) {
    e.preventDefault()
    setPending(true)
    try {
      await onConfirm()
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            loading={pending}
            variant="destructive"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
