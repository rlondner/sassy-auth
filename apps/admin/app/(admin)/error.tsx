'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground">An unexpected error occurred. The issue has been reported.</p>
      <button
        onClick={reset}
        className="px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
