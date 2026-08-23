import { signInMethodFromPath } from './sign-in-method';

describe('signInMethodFromPath', () => {
  it('maps a social callback to ext:<provider>', () => {
    expect(signInMethodFromPath('/callback/google')).toBe('ext:google');
    expect(signInMethodFromPath('/api/auth/callback/microsoft')).toBe('ext:microsoft');
    expect(signInMethodFromPath('/callback/apple')).toBe('ext:apple');
  });

  it('maps the generic-oauth callback used by the e2e stub', () => {
    expect(signInMethodFromPath('/oauth2/callback/stub')).toBe('ext:stub');
  });

  it('maps password and OTP sign-in paths to pwd', () => {
    expect(signInMethodFromPath('/sign-in/email')).toBe('pwd');
    expect(signInMethodFromPath('/api/auth/sign-in/email')).toBe('pwd');
  });

  it('returns null for an unrecognised path so callers fall back', () => {
    expect(signInMethodFromPath('/sign-in/magic-link')).toBeNull();
    expect(signInMethodFromPath(undefined)).toBeNull();
    expect(signInMethodFromPath('')).toBeNull();
  });

  it('rejects a provider name that is not one we support', () => {
    expect(signInMethodFromPath('/callback/evilprovider')).toBeNull();
  });
});
