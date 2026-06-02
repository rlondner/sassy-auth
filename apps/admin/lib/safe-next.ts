function allowlist(): string[] {
  const base = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'
  const extra = (process.env.LOGIN_NEXT_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [base, ...extra]
}

export function validateNextUrl(next: string | null | undefined): string | null {
  if (!next) return null

  // Same-origin path: must start with "/" and not be a protocol-relative
  // URL ("//x") or contain backslashes.
  if (next.startsWith('/')) {
    if (next.startsWith('//')) return null
    if (next.includes('\\')) return null
    return next
  }

  let url: URL
  try {
    url = new URL(next)
  } catch {
    return null
  }

  if (url.username || url.password) return null

  if (allowlist().includes(url.origin)) {
    return url.toString()
  }
  return null
}
