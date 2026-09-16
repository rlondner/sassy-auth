import { parseScopes } from './scopes';

describe('parseScopes', () => {
  it('keeps supported scopes in canonical order', () => {
    expect(parseScopes('email openid profile')).toEqual(['openid', 'profile', 'email']);
  });

  it('drops unrecognised scopes silently', () => {
    expect(parseScopes('openid wat offline_access')).toEqual(['openid']);
  });

  it('returns an empty list for undefined or blank input', () => {
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes('   ')).toEqual([]);
  });

  it('de-duplicates repeated scopes', () => {
    expect(parseScopes('openid openid profile')).toEqual(['openid', 'profile']);
  });
});
