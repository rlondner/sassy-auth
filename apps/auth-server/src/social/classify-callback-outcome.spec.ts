import { classifyCallbackOutcome } from './classify-callback-outcome';

// These fixtures mirror the exact shape better-auth@1.6.11 / better-call@1.3.5
// produce at ctx.context.returned on a refused /callback/:id request — see
// classify-callback-outcome.ts's header comment for the file:line evidence.
function redirectError(url: string): { status: string; headers: Headers } {
  const headers = new Headers();
  headers.set('location', url);
  return { status: 'FOUND', headers };
}

function forbiddenError(): { status: string } {
  return { status: 'FORBIDDEN' };
}

describe('classifyCallbackOutcome', () => {
  it('returns null for a successful sign-in redirect (no error param)', () => {
    expect(
      classifyCallbackOutcome(redirectError('https://admin.example/dashboard?callback=1')),
    ).toBeNull();
  });

  it('maps signup_disabled (no matching BetterAuth user) to the generic no-account code', () => {
    expect(
      classifyCallbackOutcome(redirectError('https://auth.example/error?error=signup_disabled')),
    ).toEqual({ reason: 'no_sauser_for_verified_email', code: 'social_no_account', canRedirect: true });
  });

  it('maps account_not_linked (matched user, provider email unverified) to the unverified-email code', () => {
    expect(
      classifyCallbackOutcome(redirectError('https://auth.example/error?error=account_not_linked')),
    ).toEqual({ reason: 'email_unverified', code: 'social_email_unverified', canRedirect: true });
  });

  it('maps the session gate FORBIDDEN throw to the generic no-account code, and marks it non-redirectable', () => {
    expect(classifyCallbackOutcome(forbiddenError())).toEqual({
      reason: 'sauser_not_active',
      code: 'social_no_account',
      canRedirect: false,
    });
  });

  it('returns null for an unrecognised BetterAuth error (e.g. a transport failure)', () => {
    expect(
      classifyCallbackOutcome(redirectError('https://auth.example/error?error=invalid_code')),
    ).toBeNull();
  });

  it('returns null when returned is undefined (no throw at all)', () => {
    expect(classifyCallbackOutcome(undefined)).toBeNull();
  });

  it('returns null when the redirect has no location header', () => {
    expect(classifyCallbackOutcome({ status: 'FOUND', headers: new Headers() })).toBeNull();
  });

  it('returns null when the location is unparseable as a URL', () => {
    const headers = new Headers();
    headers.set('location', 'not a url');
    expect(classifyCallbackOutcome({ status: 'FOUND', headers })).toBeNull();
  });
});
