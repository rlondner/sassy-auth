export interface DeriveSignupNameInput {
  /** The BetterAuth User row's single name field — always present, may be ''. */
  name: string;
  /** Captured out-of-band via mapProfileToUser — see social-signup-context.ts.
   * null for Apple (no capture wired) or when the provider omitted the claim. */
  givenName: string | null;
  familyName: string | null;
}

export interface DerivedSignupName {
  firstName: string;
  lastName: string;
}

/**
 * Design doc §4: given_name/family_name when the provider supplied them
 * (captured out-of-band — see social-signup-context.ts, since better-auth
 * discards these claims before the hook that calls this function ever
 * runs), else split the single `name` field on the first space.
 */
export function deriveSignupName(input: DeriveSignupNameInput): DerivedSignupName {
  if (input.givenName && input.familyName) {
    return { firstName: input.givenName, lastName: input.familyName };
  }
  const trimmed = input.name.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1) };
}
