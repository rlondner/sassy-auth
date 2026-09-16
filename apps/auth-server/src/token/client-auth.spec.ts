import { extractClientSecret, verifyClientSecret } from './client-auth';
import { hashPassword } from 'better-auth/crypto';

describe('extractClientSecret', () => {
  it('reads client_secret_basic from the Authorization header', () => {
    const encoded = Buffer.from('a_7:s3cr3t').toString('base64');
    const req = { headers: { authorization: `Basic ${encoded}` } } as never;
    expect(extractClientSecret(req, {})).toBe('s3cr3t');
  });

  it('reads client_secret_post from the body', () => {
    const req = { headers: {} } as never;
    expect(extractClientSecret(req, { client_secret: 's3cr3t' })).toBe('s3cr3t');
  });

  it('returns null when neither is present', () => {
    const req = { headers: {} } as never;
    expect(extractClientSecret(req, {})).toBeNull();
  });

  it('percent-decodes the basic credential per RFC 6749 §2.3.1', () => {
    const encoded = Buffer.from('a_7:s3%3Acr3t').toString('base64');
    const req = { headers: { authorization: `Basic ${encoded}` } } as never;
    expect(extractClientSecret(req, {})).toBe('s3:cr3t');
  });
});

describe('verifyClientSecret', () => {
  it('accepts the correct secret', async () => {
    const hash = await hashPassword('s3cr3t');
    expect(await verifyClientSecret('s3cr3t', hash)).toBe(true);
  });

  it('rejects a wrong secret', async () => {
    const hash = await hashPassword('s3cr3t');
    expect(await verifyClientSecret('nope', hash)).toBe(false);
  });

  it('rejects when no secret was presented', async () => {
    const hash = await hashPassword('s3cr3t');
    expect(await verifyClientSecret(null, hash)).toBe(false);
  });

  it('rejects when the app has no secret configured', async () => {
    expect(await verifyClientSecret('anything', null)).toBe(false);
  });
});
