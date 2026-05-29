import enMessages from '../../admin/messages/en.json'

/**
 * Look up a dot-path key in the admin en.json, e.g. t('login.email').
 * Unlike next-intl's useTranslations, the full namespace is part of the key.
 */
export function t(key: string): string {
  const value = key.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[k]
    }
    return undefined
  }, enMessages)
  if (typeof value !== 'string') {
    throw new Error(`i18n key '${key}' missing or not a string (got: ${JSON.stringify(value)})`)
  }
  return value
}
