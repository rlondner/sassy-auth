import { resolveTrustDays, getSystemTrustDays, resolvePromptEnabled, getSystemPromptEnabled } from './resolve-trust-days';

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
    // Empty string is falsy, caught by the !raw early-return guard.
    expect(getSystemTrustDays()).toBe(14);
  });

  it('falls back to 14 when TWO_FACTOR_TRUST_DAYS is a negative number string', () => {
    process.env['TWO_FACTOR_TRUST_DAYS'] = '-5';
    expect(getSystemTrustDays()).toBe(14);
  });

  it('falls back to 14 when TWO_FACTOR_TRUST_DAYS is "Infinity"', () => {
    process.env['TWO_FACTOR_TRUST_DAYS'] = 'Infinity';
    // Number('Infinity') is not an integer.
    expect(getSystemTrustDays()).toBe(14);
  });

  it('falls back to 14 when TWO_FACTOR_TRUST_DAYS is a fractional number string', () => {
    process.env['TWO_FACTOR_TRUST_DAYS'] = '7.5';
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

describe('getSystemPromptEnabled', () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns true when TWO_FACTOR_PROMPT_ENABLED is not set', () => {
    delete process.env['TWO_FACTOR_PROMPT_ENABLED'];
    expect(getSystemPromptEnabled()).toBe(true);
  });

  it('returns true when TWO_FACTOR_PROMPT_ENABLED is the empty string', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = '';
    expect(getSystemPromptEnabled()).toBe(true);
  });

  it('returns false when TWO_FACTOR_PROMPT_ENABLED is "false"', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = 'false';
    expect(getSystemPromptEnabled()).toBe(false);
  });

  it('returns false when TWO_FACTOR_PROMPT_ENABLED is "FALSE" (case-insensitive)', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = 'FALSE';
    expect(getSystemPromptEnabled()).toBe(false);
  });

  it('returns false when TWO_FACTOR_PROMPT_ENABLED is "0"', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = '0';
    expect(getSystemPromptEnabled()).toBe(false);
  });

  it('returns true when TWO_FACTOR_PROMPT_ENABLED is "true"', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = 'true';
    expect(getSystemPromptEnabled()).toBe(true);
  });

  it('returns true when TWO_FACTOR_PROMPT_ENABLED is an unrecognized string (fail open)', () => {
    process.env['TWO_FACTOR_PROMPT_ENABLED'] = 'yes-please';
    expect(getSystemPromptEnabled()).toBe(true);
  });
});

describe('resolvePromptEnabled', () => {
  it('returns the app override when it is explicitly true', () => {
    expect(resolvePromptEnabled({ twoFactorPromptEnabled: true }, false)).toBe(true);
  });

  it('returns the app override when it is explicitly false', () => {
    expect(resolvePromptEnabled({ twoFactorPromptEnabled: false }, true)).toBe(false);
  });

  it('returns systemDefault when app override is null', () => {
    expect(resolvePromptEnabled({ twoFactorPromptEnabled: null }, true)).toBe(true);
    expect(resolvePromptEnabled({ twoFactorPromptEnabled: null }, false)).toBe(false);
  });
});
