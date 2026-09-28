import { resolveClientIp } from './resolve-client-ip';

describe('resolveClientIp', () => {
  it('prefers the left-most X-Forwarded-For entry when trust proxy populated req.ips', () => {
    expect(resolveClientIp({ ips: ['203.0.113.7', '10.0.0.1'], ip: '10.0.0.1' })).toBe('203.0.113.7');
  });

  it('falls back to req.ip when req.ips is empty', () => {
    expect(resolveClientIp({ ips: [], ip: '203.0.113.7' })).toBe('203.0.113.7');
  });

  it('falls back to "unknown" when neither is present', () => {
    expect(resolveClientIp({})).toBe('unknown');
  });
});
