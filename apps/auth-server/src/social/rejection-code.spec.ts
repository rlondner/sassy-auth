import { classifyRejection } from './rejection-code';

describe('classifyRejection', () => {
  it('returns null when the sign-in should proceed', () => {
    expect(
      classifyRejection({ emailVerified: true, isPrivateEmail: false, matchedUser: true }),
    ).toBeNull();
  });

  it('flags an unverified provider email specifically', () => {
    expect(
      classifyRejection({ emailVerified: false, isPrivateEmail: false, matchedUser: false }),
    ).toEqual({ reason: 'email_unverified', code: 'social_email_unverified' });
  });

  it('flags an Apple private relay address specifically, since the user is stuck otherwise', () => {
    expect(
      classifyRejection({ emailVerified: true, isPrivateEmail: true, matchedUser: false }),
    ).toEqual({ reason: 'private_relay', code: 'social_private_relay' });
  });

  it('collapses "no such user" into a generic code to avoid enumeration', () => {
    expect(
      classifyRejection({ emailVerified: true, isPrivateEmail: false, matchedUser: false }),
    ).toEqual({ reason: 'no_sauser_for_verified_email', code: 'social_no_account' });
  });

  it('prefers the unverified-email reason over private relay when both apply', () => {
    expect(
      classifyRejection({ emailVerified: false, isPrivateEmail: true, matchedUser: false }),
    ).toEqual({ reason: 'email_unverified', code: 'social_email_unverified' });
  });
});
