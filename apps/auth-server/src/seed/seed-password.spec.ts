import { DEV_SEED_PASSWORD, resolveSeedPassword } from './seed-password';

describe('resolveSeedPassword', () => {
  it('uses SEED_ADMIN_PASSWORD when set', () => {
    expect(resolveSeedPassword({ SEED_ADMIN_PASSWORD: 'from-seed-var' })).toBe('from-seed-var');
  });

  it('falls back to E2E_ADMIN_PASSWORD so the seed and the e2e suite stay in sync', () => {
    expect(resolveSeedPassword({ E2E_ADMIN_PASSWORD: 'from-e2e-var' })).toBe('from-e2e-var');
  });

  it('prefers SEED_ADMIN_PASSWORD over E2E_ADMIN_PASSWORD', () => {
    const env = { SEED_ADMIN_PASSWORD: 'wins', E2E_ADMIN_PASSWORD: 'loses' };
    expect(resolveSeedPassword(env)).toBe('wins');
  });

  it('treats an empty value as unset', () => {
    const env = { SEED_ADMIN_PASSWORD: '', E2E_ADMIN_PASSWORD: 'from-e2e-var' };
    expect(resolveSeedPassword(env)).toBe('from-e2e-var');
  });

  it('returns the documented dev default when NODE_ENV is unset', () => {
    expect(resolveSeedPassword({})).toBe(DEV_SEED_PASSWORD);
  });

  it('returns the documented dev default in development', () => {
    expect(resolveSeedPassword({ NODE_ENV: 'development' })).toBe(DEV_SEED_PASSWORD);
  });

  it('returns the documented dev default in test, so CI seeds without extra config', () => {
    expect(resolveSeedPassword({ NODE_ENV: 'test' })).toBe(DEV_SEED_PASSWORD);
  });

  it('refuses the dev default in production', () => {
    expect(() => resolveSeedPassword({ NODE_ENV: 'production' })).toThrow(/SEED_ADMIN_PASSWORD/);
  });

  it('seeds in production when an explicit password is supplied', () => {
    const env = { NODE_ENV: 'production', SEED_ADMIN_PASSWORD: 'a-real-one' };
    expect(resolveSeedPassword(env)).toBe('a-real-one');
  });
});
