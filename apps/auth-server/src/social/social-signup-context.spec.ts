import {
  runWithSocialSignupContext,
  captureSocialSignupClientId,
  captureSocialSignupProfileName,
  readSocialSignupContext,
} from './social-signup-context';

describe('social-signup-context', () => {
  it('returns all-null outside any capture scope', () => {
    expect(readSocialSignupContext()).toEqual({ clientId: null, givenName: null, familyName: null });
  });

  it('captures and reads back clientId within a scope', () => {
    runWithSocialSignupContext(() => {
      captureSocialSignupClientId('sq_abc');
      expect(readSocialSignupContext()).toEqual({ clientId: 'sq_abc', givenName: null, familyName: null });
    });
  });

  it('captures and reads back givenName/familyName within a scope', () => {
    runWithSocialSignupContext(() => {
      captureSocialSignupProfileName('Ada', 'Lovelace');
      expect(readSocialSignupContext()).toEqual({ clientId: null, givenName: 'Ada', familyName: 'Lovelace' });
    });
  });

  it('capture calls outside any scope are no-ops, not throws', () => {
    expect(() => captureSocialSignupClientId('sq_abc')).not.toThrow();
    expect(() => captureSocialSignupProfileName('Ada', 'Lovelace')).not.toThrow();
    expect(readSocialSignupContext()).toEqual({ clientId: null, givenName: null, familyName: null });
  });

  it('two concurrent scopes do not cross-contaminate', async () => {
    const results: unknown[] = [];
    await Promise.all([
      runWithSocialSignupContext(async () => {
        captureSocialSignupClientId('sq_1');
        await new Promise((r) => setTimeout(r, 10));
        results.push(readSocialSignupContext());
      }),
      runWithSocialSignupContext(async () => {
        captureSocialSignupClientId('sq_2');
        await new Promise((r) => setTimeout(r, 1));
        results.push(readSocialSignupContext());
      }),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        { clientId: 'sq_1', givenName: null, familyName: null },
        { clientId: 'sq_2', givenName: null, familyName: null },
      ]),
    );
  });
});
