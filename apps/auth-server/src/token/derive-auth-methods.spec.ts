import { deriveAuthMethods } from './derive-auth-methods';

describe('deriveAuthMethods', () => {
  it('reports a password sign-in as pwd with no idp', () => {
    expect(deriveAuthMethods({ signInMethod: 'pwd', twoFactorEnabled: false })).toEqual({
      amr: ['pwd'],
    });
  });

  it('adds otp and mfa when TOTP is enrolled', () => {
    expect(deriveAuthMethods({ signInMethod: 'pwd', twoFactorEnabled: true })).toEqual({
      amr: ['pwd', 'otp', 'mfa'],
    });
  });

  it('reports a federated sign-in as ext and names the provider', () => {
    expect(deriveAuthMethods({ signInMethod: 'ext:google', twoFactorEnabled: false })).toEqual({
      amr: ['ext'],
      idp: 'google',
    });
  });

  it('combines federated sign-in with TOTP', () => {
    expect(deriveAuthMethods({ signInMethod: 'ext:apple', twoFactorEnabled: true })).toEqual({
      amr: ['ext', 'otp', 'mfa'],
      idp: 'apple',
    });
  });

  it('never claims pwd for a federated session', () => {
    const { amr } = deriveAuthMethods({ signInMethod: 'ext:microsoft', twoFactorEnabled: true });
    expect(amr).not.toContain('pwd');
  });

  it('falls back to legacy behaviour for sessions with no recorded method', () => {
    expect(deriveAuthMethods({ signInMethod: null, twoFactorEnabled: false })).toEqual({
      amr: ['pwd'],
    });
    expect(deriveAuthMethods({ signInMethod: null, twoFactorEnabled: true })).toEqual({
      amr: ['pwd', 'otp', 'mfa'],
    });
  });
});
