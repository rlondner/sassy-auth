export interface SocialSignupEligibilityInput {
  defaultOrgId: number | null;
  defaultRoleId: number | null;
  /** Accepted but deliberately ignored — see the design doc §1: no
   * isPlatform carve-out. Present only so callers can pass a full SaApp row
   * without picking fields first. */
  isPlatform?: boolean;
}

/**
 * Whether a first-time social identity against this app may be
 * auto-provisioned, instead of refused. Reuses the exact signal self-serve
 * email signup already relies on (registration.service.ts) — no separate
 * flag, no isPlatform carve-out. See design doc §1.
 */
export function resolveSocialSignupEligibility(app: SocialSignupEligibilityInput): boolean {
  return app.defaultOrgId !== null && app.defaultRoleId !== null;
}
