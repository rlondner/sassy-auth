import { TurnstileService } from './turnstile.service';

describe('TurnstileService', () => {
  let service: TurnstileService;
  const ORIGINAL_ENV = process.env.TURNSTILE_SECRET_KEY;

  beforeEach(() => {
    service = new TurnstileService();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.TURNSTILE_SECRET_KEY = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it('returns false without calling fetch when TURNSTILE_SECRET_KEY is unset', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;

    await expect(service.verify('some-token')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts the secret and token to the Cloudflare siteverify endpoint', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await service.verify('the-token');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'test-secret', response: 'the-token' }),
      }),
    );
  });

  it('returns true when Cloudflare responds success: true', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await expect(service.verify('the-token')).resolves.toBe(true);
  });

  it('returns false when Cloudflare responds success: false', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });

    await expect(service.verify('bad-token')).resolves.toBe(false);
  });

  it('returns false when the HTTP response is not ok', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({}) });

    await expect(service.verify('the-token')).resolves.toBe(false);
  });

  it('returns false (fails closed) when the fetch call itself rejects', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.verify('the-token')).resolves.toBe(false);
  });
});
