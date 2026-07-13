import { isTwoFactorRequired, isPlatformTwoFactorRequired } from './two-factor-required';

describe('isTwoFactorRequired', () => {
  const OLD = process.env.PLATFORM_REQUIRE_2FA;
  afterEach(() => { process.env.PLATFORM_REQUIRE_2FA = OLD; });

  it('honors the per-app flag for non-platform apps', () => {
    expect(isTwoFactorRequired({ requireTwoFactor: true, isPlatform: false })).toBe(true);
    expect(isTwoFactorRequired({ requireTwoFactor: false, isPlatform: false })).toBe(false);
  });

  it('requires 2FA for the platform app only when the env flag is on', () => {
    process.env.PLATFORM_REQUIRE_2FA = 'true';
    expect(isTwoFactorRequired({ requireTwoFactor: false, isPlatform: true })).toBe(true);
    process.env.PLATFORM_REQUIRE_2FA = 'false';
    expect(isTwoFactorRequired({ requireTwoFactor: false, isPlatform: true })).toBe(false);
    delete process.env.PLATFORM_REQUIRE_2FA;
    expect(isTwoFactorRequired({ requireTwoFactor: false, isPlatform: true })).toBe(false);
  });

  it('isPlatformTwoFactorRequired reads only the env flag', () => {
    process.env.PLATFORM_REQUIRE_2FA = '1';
    expect(isPlatformTwoFactorRequired()).toBe(false); // only "true" (case-insensitive) counts
    process.env.PLATFORM_REQUIRE_2FA = 'TRUE';
    expect(isPlatformTwoFactorRequired()).toBe(true);
  });
});
