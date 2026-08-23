/**
 * Map a refused federated sign-in to (a) the real reason, which goes into the
 * audit trail, and (b) the code the user's error page shows.
 *
 * The two differ on purpose. Where the user has already proved control of the
 * identity, a specific message discloses nothing and saves a support ticket.
 * Where they have not, the message is generic so social login cannot be used
 * to enumerate registered addresses — the same stance directLogin takes by
 * collapsing distinct failures into INVALID_CREDENTIALS.
 */
export function classifyRejection(input: {
  emailVerified: boolean;
  isPrivateEmail: boolean;
  matchedUser: boolean;
}): { reason: string; code: string } | null {
  if (input.matchedUser && input.emailVerified) return null;

  // Checked first: an unverified email is refused regardless of relay status,
  // and it is the more actionable message of the two.
  if (!input.emailVerified) {
    return { reason: 'email_unverified', code: 'social_email_unverified' };
  }

  if (input.isPrivateEmail) {
    return { reason: 'private_relay', code: 'social_private_relay' };
  }

  return { reason: 'no_sauser_for_verified_email', code: 'social_no_account' };
}
