import en from '../en.json'
import fr from '../fr.json'

function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    flattenKeys(value, prefix ? `${prefix}.${key}` : key),
  )
}

describe('messages locale parity', () => {
  it('en.json and fr.json expose the exact same set of translation keys', () => {
    const enKeys = new Set(flattenKeys(en))
    const frKeys = new Set(flattenKeys(fr))

    const missingInFr = [...enKeys].filter((k) => !frKeys.has(k)).sort()
    const missingInEn = [...frKeys].filter((k) => !enKeys.has(k)).sort()

    // Two prior bugs (missing signup.verified.*, then login.error.unverified /
    // users.status.unverified / apps.fields.defaultOrg* / signup.errors.captcha*)
    // shipped because nothing caught a key present in one locale but not the
    // other. This test closes that gap going forward.
    expect(missingInFr).toEqual([])
    expect(missingInEn).toEqual([])
  })
})
