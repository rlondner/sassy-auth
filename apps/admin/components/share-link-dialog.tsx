'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button,
} from '@sassy-auth/ui'
import { useCopyFeedback } from '@/lib/use-copy-feedback'

interface ShareLinkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  url: string
}

export function ShareLinkDialog({ open, onOpenChange, title, description, url }: ShareLinkDialogProps) {
  const t = useTranslations()
  const { copiedKey, copy } = useCopyFeedback()

  const isCopied = copiedKey === 'shareLink'

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            aria-label={title}
            onClick={(e) => e.currentTarget.select()}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 rounded border border-border bg-muted px-3 py-2 text-body-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(url, 'shareLink')}
          >
            {isCopied ? t('users.drawer.copied') : t('users.drawer.copyLink')}
          </Button>
        </div>
        <AlertDialogFooter>
          <AlertDialogAction>{t('users.drawer.done')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
