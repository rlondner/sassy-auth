import { appendConsentRedirect } from './resolve-social-consent-redirect';

describe('appendConsentRedirect', () => {
  it('returns null when there is nothing outstanding', () => {
    expect(appendConsentRedirect({
      currentLocation: 'https://app.example.com/callback?code=abc',
      appPublicId: 'sq_1',
      outstanding: [],
      adminUrl: 'https://admin.example.com',
    })).toBeNull();
  });

  it('rewrites to /login/consent, carrying appPublicId and the original location as next', () => {
    const result = appendConsentRedirect({
      currentLocation: 'https://app.example.com/callback?code=abc',
      appPublicId: 'sq_1',
      outstanding: [{ documentType: 'terms', url: 'https://a.example.com/terms' }],
      adminUrl: 'https://admin.example.com',
    });
    expect(result).toBe(
      'https://admin.example.com/login/consent?appPublicId=sq_1&next=' +
        encodeURIComponent('https://app.example.com/callback?code=abc'),
    );
  });
});
