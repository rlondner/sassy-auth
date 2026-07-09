import { runWithResetUrlCapture, captureResetUrl } from './reset-url-context';

describe('reset-url-context', () => {
  it('captures a URL written from inside the scope', async () => {
    const { result, resetUrl } = await runWithResetUrlCapture(async () => {
      captureResetUrl('https://x/reset-password?token=abc');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(resetUrl).toBe('https://x/reset-password?token=abc');
  });

  it('captureResetUrl outside any scope is a no-op (no throw)', () => {
    expect(() => captureResetUrl('https://x')).not.toThrow();
  });
});
