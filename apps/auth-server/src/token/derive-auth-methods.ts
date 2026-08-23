/**
 * Turn a session's recorded sign-in method into RFC 8176-shaped `amr` values
 * plus an `idp` claim.
 *
 * Why `ext`: RFC 8176 registers no value meaning "federated", so `ext` is a
 * convention. The provider name goes in a dedicated `idp` claim rather than
 * into `amr`, so resource servers keep a bounded set of amr values to match.
 *
 * Why this matters: emitting `pwd` for a Google sign-in asserts to every
 * resource server that a password was verified when none was.
 */
export function deriveAuthMethods(input: {
  signInMethod: string | null;
  twoFactorEnabled: boolean;
}): { amr: string[]; idp?: string } {
  const { signInMethod, twoFactorEnabled } = input;
  const second = twoFactorEnabled ? ['otp', 'mfa'] : [];

  if (signInMethod?.startsWith('ext:')) {
    const idp = signInMethod.slice('ext:'.length);
    return { amr: ['ext', ...second], idp };
  }

  // 'pwd' and null (sessions predating Session.signInMethod) both take the
  // legacy path, so existing sessions keep their current claims.
  return { amr: ['pwd', ...second] };
}
