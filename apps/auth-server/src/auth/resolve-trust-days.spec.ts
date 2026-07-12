import { resolveTrustDays, getSystemTrustDays } from './resolve-trust-days';

describe('getSystemTrustDays', () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns 14 when TWO_FACTOR_TRUST_DAYS is not set', () => {
    delete process.env['TWO_FACTOR_TRUST_DAYS'];
    expect(getSystemTrustDays()).toBe(14);
  });

  it('returns the numeric value when TWO_FACTOR_TRUST_DAYS is a valid integer string', () => {
    process.env['TWO_FACTOR_TRUST_DAYS'] = '30';
    expect(getSystemTrustDays()).toBe(30);
  });

  it('falls back to 14 when TWO_FACTOR_TRUST_DAYS is NaN (non-numeric string)', () => {
    process.env['TWO_FACTOR_TRUST_DAYS'] = 'not-a-number';
    expect(getSystemTrustDays()).toBe(14);
  });

  it('falls back to 14 when TWO_FACTOR_TRUST_DAYS is the empty string', () => {
    process.env['TWO_FACTOR_TRUST_DAYS'] = '';
    // Number('') === 0 which is falsy but not NaN — treat 0 as invalid.
    expect(getSystemTrustDays()).toBe(14);
  });
});

describe('resolveTrustDays', () => {
  const DEFAULT = 14;

  it('returns the app override when it is a positive integer', () => {
    expect(resolveTrustDays({ twoFactorTrustDays: 7 }, DEFAULT)).toBe(7);
  });

  it('returns systemDefault when app override is null', () => {
    expect(resolveTrustDays({ twoFactorTrustDays: null }, DEFAULT)).toBe(DEFAULT);
  });

  it('returns systemDefault when app override is 0', () => {
    expect(resolveTrustDays({ twoFactorTrustDays: 0 }, DEFAULT)).toBe(DEFAULT);
  });

  it('returns systemDefault when app override is negative', () => {
    expect(resolveTrustDays({ twoFactorTrustDays: -5 }, DEFAULT)).toBe(DEFAULT);
  });

  it('returns 1 (minimum positive) when app override is 1', () => {
    expect(resolveTrustDays({ twoFactorTrustDays: 1 }, DEFAULT)).toBe(1);
  });
});
