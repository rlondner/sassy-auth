import { resolveRequiredConsent } from './resolve-required-consent';

describe('resolveRequiredConsent', () => {
  it('returns nothing when the app configures no documents', () => {
    const app = { privacyPolicyUrl: null, termsUrl: null, gdprUrl: null };
    expect(resolveRequiredConsent(app, 'US')).toEqual([]);
  });

  it('includes privacy_policy and terms whenever their URL is set, regardless of country', () => {
    const app = { privacyPolicyUrl: 'https://a.example.com/privacy', termsUrl: 'https://a.example.com/terms', gdprUrl: null };
    expect(resolveRequiredConsent(app, 'US')).toEqual([
      { documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
      { documentType: 'terms', url: 'https://a.example.com/terms' },
    ]);
  });

  it('includes gdpr when its URL is set and the country is GDPR-applicable', () => {
    const app = { privacyPolicyUrl: null, termsUrl: null, gdprUrl: 'https://a.example.com/gdpr' };
    expect(resolveRequiredConsent(app, 'DE')).toEqual([{ documentType: 'gdpr', url: 'https://a.example.com/gdpr' }]);
  });

  it('excludes gdpr when its URL is set but the country is not GDPR-applicable', () => {
    const app = { privacyPolicyUrl: null, termsUrl: null, gdprUrl: 'https://a.example.com/gdpr' };
    expect(resolveRequiredConsent(app, 'US')).toEqual([]);
  });

  it('fails closed: includes gdpr when its URL is set and the country is unresolved (null)', () => {
    const app = { privacyPolicyUrl: null, termsUrl: null, gdprUrl: 'https://a.example.com/gdpr' };
    expect(resolveRequiredConsent(app, null)).toEqual([{ documentType: 'gdpr', url: 'https://a.example.com/gdpr' }]);
  });

  it('excludes gdpr regardless of country when gdprUrl is not set', () => {
    const app = { privacyPolicyUrl: null, termsUrl: null, gdprUrl: null };
    expect(resolveRequiredConsent(app, null)).toEqual([]);
  });
});
