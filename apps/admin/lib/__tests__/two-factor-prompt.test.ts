import { shouldPromptTwoFactor, getSystemTrustDaysClient } from '../two-factor-prompt'

describe('shouldPromptTwoFactor', () => {
  it('returns false when the user already has 2FA enabled', () => {
    const result = shouldPromptTwoFactor({
      twoFactorEnabled: true,
      promptedAt: null,
      now: new Date('2026-08-23T00:00:00Z'),
      intervalDays: 14,
    })

    expect(result).toBe(false)
  })

  it('returns true when the user has never been prompted', () => {
    const result = shouldPromptTwoFactor({
      twoFactorEnabled: false,
      promptedAt: null,
      now: new Date('2026-08-23T00:00:00Z'),
      intervalDays: 14,
    })

    expect(result).toBe(true)
  })

  it('returns false when the last prompt was inside the interval', () => {
    const result = shouldPromptTwoFactor({
      twoFactorEnabled: false,
      promptedAt: new Date('2026-08-20T00:00:00Z'),
      now: new Date('2026-08-23T00:00:00Z'),
      intervalDays: 14,
    })

    expect(result).toBe(false)
  })

  it('returns true when the last prompt was strictly past the interval', () => {
    const result = shouldPromptTwoFactor({
      twoFactorEnabled: false,
      promptedAt: new Date('2026-08-01T00:00:00Z'),
      now: new Date('2026-08-23T00:00:00Z'),
      intervalDays: 14,
    })

    expect(result).toBe(true)
  })

  it('returns false at the exact interval boundary, not true', () => {
    const promptedAt = new Date('2026-08-09T00:00:00Z')
    const now = new Date(promptedAt.getTime() + 14 * 24 * 60 * 60 * 1000)

    const result = shouldPromptTwoFactor({
      twoFactorEnabled: false,
      promptedAt,
      now,
      intervalDays: 14,
    })

    expect(result).toBe(false)
  })

  // Guards the `!promptedAt` shorthand at two-factor-prompt.ts:14 against the
  // canonical `promptedAt === null` in
  // apps/auth-server/src/auth/should-prompt-two-factor.ts. A Date is an object
  // and therefore always truthy — including the epoch — so the two forms agree
  // on every Date | null input. This case fails if the parameter is ever
  // widened to a nullable timestamp number, where 0 would become falsy and the
  // shorthand would silently start re-prompting.
  it('treats an epoch promptedAt as a real timestamp, not as never-prompted', () => {
    const result = shouldPromptTwoFactor({
      twoFactorEnabled: false,
      promptedAt: new Date(0),
      now: new Date(1000),
      intervalDays: 14,
    })

    expect(result).toBe(false)
  })
})

describe('getSystemTrustDaysClient', () => {
  const originalEnv = process.env['TWO_FACTOR_TRUST_DAYS']

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['TWO_FACTOR_TRUST_DAYS']
    else process.env['TWO_FACTOR_TRUST_DAYS'] = originalEnv
  })

  it('defaults to 14 when unset', () => {
    delete process.env['TWO_FACTOR_TRUST_DAYS']
    expect(getSystemTrustDaysClient()).toBe(14)
  })

  it('defaults to 14 when zero', () => {
    process.env['TWO_FACTOR_TRUST_DAYS'] = '0'
    expect(getSystemTrustDaysClient()).toBe(14)
  })

  it('defaults to 14 when negative', () => {
    process.env['TWO_FACTOR_TRUST_DAYS'] = '-5'
    expect(getSystemTrustDaysClient()).toBe(14)
  })

  it('defaults to 14 when fractional', () => {
    process.env['TWO_FACTOR_TRUST_DAYS'] = '7.5'
    expect(getSystemTrustDaysClient()).toBe(14)
  })

  it('uses the env var when it is a valid positive integer', () => {
    process.env['TWO_FACTOR_TRUST_DAYS'] = '30'
    expect(getSystemTrustDaysClient()).toBe(30)
  })
})
