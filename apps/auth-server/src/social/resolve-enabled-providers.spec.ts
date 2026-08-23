import { resolveEnabledProviders } from './resolve-enabled-providers';

describe('resolveEnabledProviders', () => {
  const globalGoogle = { appId: null, provider: 'google', enabled: true };
  const globalMicrosoft = { appId: null, provider: 'microsoft', enabled: true };

  it('returns a globally enabled provider when the app has no opinion', () => {
    expect(resolveEnabledProviders([globalGoogle], ['google'], 7)).toEqual(['google']);
  });

  it('omits a provider with no credentials even when a global row exists', () => {
    expect(resolveEnabledProviders([globalGoogle], [], 7)).toEqual([]);
  });

  it('omits a provider with credentials but no global row', () => {
    expect(resolveEnabledProviders([], ['google'], 7)).toEqual([]);
  });

  it("lets an app row disable a globally enabled provider", () => {
    const rows = [globalGoogle, { appId: 7, provider: 'google', enabled: false }];
    expect(resolveEnabledProviders(rows, ['google'], 7)).toEqual([]);
  });

  it("lets an app row enable a globally disabled provider", () => {
    const rows = [
      { appId: null, provider: 'google', enabled: false },
      { appId: 7, provider: 'google', enabled: true },
    ];
    expect(resolveEnabledProviders(rows, ['google'], 7)).toEqual(['google']);
  });

  it('ignores another app\'s row', () => {
    const rows = [globalGoogle, { appId: 99, provider: 'google', enabled: false }];
    expect(resolveEnabledProviders(rows, ['google'], 7)).toEqual(['google']);
  });

  it('returns providers in a stable order regardless of row order', () => {
    const rows = [globalMicrosoft, globalGoogle];
    expect(resolveEnabledProviders(rows, ['microsoft', 'google'], 7)).toEqual([
      'google',
      'microsoft',
    ]);
  });

  it('resolves the global default set when appId is null', () => {
    const rows = [globalGoogle, { appId: 7, provider: 'google', enabled: false }];
    expect(resolveEnabledProviders(rows, ['google'], null)).toEqual(['google']);
  });
});
