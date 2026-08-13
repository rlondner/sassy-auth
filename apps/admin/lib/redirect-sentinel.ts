/**
 * bug-0221: `redirect()` (called by `apiFetch` on a 401) and `notFound()`
 * signal Next.js by throwing a sentinel Error carrying a `digest` string.
 * Next's own machinery watches for it — any `catch` that swallows the
 * sentinel silently cancels the navigation and strands the user on a dead
 * page. Every catch-all around a server action, client or server side,
 * must let it through.
 */
export function isRedirectSentinel(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest
  return (
    typeof digest === 'string' &&
    (digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND')
  )
}
