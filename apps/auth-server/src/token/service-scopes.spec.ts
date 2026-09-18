import { parseServiceScopes, SUPPORTED_SERVICE_SCOPES } from './service-scopes';

describe('SUPPORTED_SERVICE_SCOPES', () => {
  it('contains exactly roles:write', () => {
    expect(SUPPORTED_SERVICE_SCOPES).toEqual(['roles:write']);
  });
});

describe('parseServiceScopes', () => {
  it('keeps recognised service scopes', () => {
    expect(parseServiceScopes('roles:write')).toEqual(['roles:write']);
  });

  it('drops unrecognised scopes silently', () => {
    expect(parseServiceScopes('roles:write openid wat')).toEqual(['roles:write']);
  });

  it('returns an empty list for undefined or blank input', () => {
    expect(parseServiceScopes(undefined)).toEqual([]);
    expect(parseServiceScopes('   ')).toEqual([]);
  });

  it('de-duplicates repeated scopes', () => {
    expect(parseServiceScopes('roles:write roles:write')).toEqual(['roles:write']);
  });
});
