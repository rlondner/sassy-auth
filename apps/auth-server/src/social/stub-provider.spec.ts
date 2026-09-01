import { stubProviderConfig } from './stub-provider';

describe('stubProviderConfig', () => {
  it('is empty when the stub URL is not set', () => {
    expect(stubProviderConfig({ NODE_ENV: 'test' })).toEqual([]);
  });

  it('REFUSES to register in production even when the URL is set', () => {
    expect(
      stubProviderConfig({ NODE_ENV: 'production', E2E_STUB_IDP_URL: 'http://localhost:9099' }),
    ).toEqual([]);
  });

  it('registers a provider called stub outside production', () => {
    const [config] = stubProviderConfig({
      NODE_ENV: 'test',
      E2E_STUB_IDP_URL: 'http://localhost:9099',
    }) as { providerId: string; discoveryUrl: string; disableSignUp: boolean }[];
    expect(config.providerId).toBe('stub');
    expect(config.discoveryUrl).toBe('http://localhost:9099/.well-known/openid-configuration');
    expect(config.disableSignUp).toBe(true);
  });

  // Positive-allowlist coverage (task-11 controller ruling): a `!==
  // 'production'` blocklist fails OPEN on exactly these ambiguous values, so
  // each must independently prove the stub stays off.
  it('refuses when NODE_ENV is unset even though the URL is set', () => {
    expect(stubProviderConfig({ E2E_STUB_IDP_URL: 'http://localhost:9099' })).toEqual([]);
  });

  it("refuses when NODE_ENV is mis-cased ('Production')", () => {
    expect(
      stubProviderConfig({ NODE_ENV: 'Production', E2E_STUB_IDP_URL: 'http://localhost:9099' }),
    ).toEqual([]);
  });

  it('refuses when NODE_ENV is an empty string', () => {
    expect(
      stubProviderConfig({ NODE_ENV: '', E2E_STUB_IDP_URL: 'http://localhost:9099' }),
    ).toEqual([]);
  });

  it('registers the stub when NODE_ENV is development', () => {
    const configs = stubProviderConfig({
      NODE_ENV: 'development',
      E2E_STUB_IDP_URL: 'http://localhost:9099',
    });
    expect(configs).toHaveLength(1);
  });

  it('is empty when NODE_ENV is test but the URL is unset', () => {
    expect(stubProviderConfig({ NODE_ENV: 'test' })).toEqual([]);
  });
});
