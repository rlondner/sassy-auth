import { isAppUrlAllowed, isInsecureAppUrlsAllowed } from './app-url-policy';

describe('app-url-policy', () => {
  const original = process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
  afterEach(() => {
    if (original === undefined) delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
    else process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = original;
  });

  describe('isInsecureAppUrlsAllowed', () => {
    it('is false when unset', () => {
      delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS;
      expect(isInsecureAppUrlsAllowed()).toBe(false);
    });
    it('is true only for the exact string "true"', () => {
      process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = 'true';
      expect(isInsecureAppUrlsAllowed()).toBe(true);
      process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = 'TRUE';
      expect(isInsecureAppUrlsAllowed()).toBe(false);
      process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = '1';
      expect(isInsecureAppUrlsAllowed()).toBe(false);
    });
  });

  describe('isAppUrlAllowed (secure mode, default)', () => {
    beforeEach(() => { delete process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS; });
    it('accepts https public host', () => {
      expect(isAppUrlAllowed('https://app.example.com/cb')).toBe(true);
    });
    it('rejects http', () => {
      expect(isAppUrlAllowed('http://app.example.com')).toBe(false);
    });
    it('rejects localhost and *.localhost', () => {
      expect(isAppUrlAllowed('https://localhost:3000')).toBe(false);
      expect(isAppUrlAllowed('https://api.localhost')).toBe(false);
    });
    it('rejects loopback IPs', () => {
      expect(isAppUrlAllowed('https://127.0.0.1:3000')).toBe(false);
      expect(isAppUrlAllowed('http://[::1]:3000')).toBe(false);
    });
    it('rejects bare host with no dot', () => {
      expect(isAppUrlAllowed('https://intranet')).toBe(false);
    });
    it('rejects non-string, empty, and malformed', () => {
      expect(isAppUrlAllowed(undefined)).toBe(false);
      expect(isAppUrlAllowed('')).toBe(false);
      expect(isAppUrlAllowed('not a url')).toBe(false);
      expect(isAppUrlAllowed('ftp://example.com')).toBe(false);
    });
  });

  describe('isAppUrlAllowed (insecure mode)', () => {
    beforeEach(() => { process.env.SASSY_AUTH_ALLOW_INSECURE_APP_URLS = 'true'; });
    it('accepts http localhost', () => {
      expect(isAppUrlAllowed('http://localhost:3000/cb')).toBe(true);
    });
    it('accepts loopback IP', () => {
      expect(isAppUrlAllowed('http://127.0.0.1:8080')).toBe(true);
    });
    it('still rejects non-http(s) and malformed', () => {
      expect(isAppUrlAllowed('ftp://localhost')).toBe(false);
      expect(isAppUrlAllowed('nonsense')).toBe(false);
    });
  });
});
