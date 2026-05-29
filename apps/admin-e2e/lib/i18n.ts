import enMessages from '../../admin/messages/en.json'

// Walk a dot-path: 'login.email' → enMessages.login.email.
// Throws on missing key — a dropped i18n entry should surface as a
// loud test error, not a silent selector miss.
export function t(key: string): string {
  const value = key.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k]
    }
    return undefined
  }, enMessages)
  if (typeof value !== 'string') {
    throw new Error(`i18n key missing or not a string: ${key}`)
  }
  return value
}
