import { parseScopes, SUPPORTED_SCOPES } from './scopes';

describe('parseScopes', () => {
  it('keeps supported scopes in canonical order', () => {
    expect(parseScopes('email openid profile')).toEqual(['openid', 'profile', 'email']);
  });

  it('drops unrecognised scopes silently', () => {
    expect(parseScopes('openid wat bogus')).toEqual(['openid']);
  });

  it('returns an empty list for undefined or blank input', () => {
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes('   ')).toEqual([]);
  });

  it('de-duplicates repeated scopes', () => {
    expect(parseScopes('openid openid profile')).toEqual(['openid', 'profile']);
  });

  it('includes offline_access in the supported scope list', () => {
    expect(SUPPORTED_SCOPES).toContain('offline_access');
  });

  it('grants offline_access when requested', () => {
    expect(parseScopes('openid offline_access')).toEqual(['openid', 'offline_access']);
  });

  it('drops offline_access when not requested', () => {
    expect(parseScopes('openid profile')).toEqual(['openid', 'profile']);
  });
});
