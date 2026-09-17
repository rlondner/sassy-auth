'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { captureClientError, initOtelClient } from '@sassy-auth/telemetry/client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    initOtelClient('sassy-auth-admin')
    captureClientError(error, { boundary: 'global-error' })
  }, [error])

  return (
    <html>
      <body>
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h2>Something went wrong</h2>
          <p>An unexpected error occurred. The issue has been reported.</p>
          <button
            onClick={reset}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: '1px solid #d1d5db',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
