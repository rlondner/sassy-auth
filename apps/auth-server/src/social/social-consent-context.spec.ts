import { runWithSocialConsentCapture, captureSocialSignInUserId, readSocialConsentContext } from './social-consent-context';

describe('social-consent-context', () => {
  it('returns the captured ip and userId inside the same capture scope', async () => {
    await runWithSocialConsentCapture('203.0.113.7', async () => {
      captureSocialSignInUserId('ba-user-1');
      expect(readSocialConsentContext()).toEqual({ ip: '203.0.113.7', userId: 'ba-user-1' });
    });
  });

  it('returns null userId when nothing has captured it yet', async () => {
    await runWithSocialConsentCapture('203.0.113.7', async () => {
      expect(readSocialConsentContext()).toEqual({ ip: '203.0.113.7', userId: null });
    });
  });

  it('returns ip null and userId null outside any capture scope', () => {
    expect(readSocialConsentContext()).toEqual({ ip: null, userId: null });
  });

  it('keeps two concurrent capture scopes independent', async () => {
    const results: Array<{ ip: string | null; userId: string | null }> = [];
    await Promise.all([
      runWithSocialConsentCapture('1.1.1.1', async () => {
        captureSocialSignInUserId('user-a');
        await new Promise((r) => setTimeout(r, 10));
        results.push(readSocialConsentContext());
      }),
      runWithSocialConsentCapture('2.2.2.2', async () => {
        captureSocialSignInUserId('user-b');
        results.push(readSocialConsentContext());
      }),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        { ip: '1.1.1.1', userId: 'user-a' },
        { ip: '2.2.2.2', userId: 'user-b' },
      ]),
    );
  });
});
