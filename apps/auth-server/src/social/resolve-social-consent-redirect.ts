import type { RequiredConsentDocument } from '../consent/resolve-required-consent';

/**
 * Pure URL-construction step: given the browser's intended post-sign-in
 * destination and what's outstanding, decide whether to reroute through
 * /login/consent first. Kept separate from auth.config.ts's hook (which
 * does the DB lookups and header mutation) so this piece is unit-testable
 * without any BetterAuth/Prisma scaffolding.
 */
export function appendConsentRedirect(params: {
  currentLocation: string;
  appPublicId: string;
  outstanding: RequiredConsentDocument[];
  adminUrl: string;
}): string | null {
  if (params.outstanding.length === 0) return null;
  const target = new URL('/login/consent', params.adminUrl);
  target.searchParams.set('appPublicId', params.appPublicId);
  target.searchParams.set('next', params.currentLocation);
  return target.toString();
}
