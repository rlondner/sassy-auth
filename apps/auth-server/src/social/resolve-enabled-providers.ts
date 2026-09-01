/**
 * Social provider identifiers. `stub` exists only for e2e (see the stub IdP
 * task) and is never registered when NODE_ENV === 'production'.
 */
export type SocialProviderId = 'google' | 'microsoft' | 'apple' | 'stub';

/** Stable display order, independent of database row order. */
export const PROVIDER_ORDER: readonly SocialProviderId[] = [
  'google',
  'microsoft',
  'apple',
  'stub',
];

export interface ProviderRow {
  appId: number | null;
  provider: string;
  enabled: boolean;
}

/**
 * Decide which providers an app's login screen shows.
 *
 * A provider is *available* when the deployment has credentials for it
 * (`available`, derived from env) AND a global row exists (appId === null).
 * It is *shown for this app* when the app's own row says enabled, or the app
 * has no row and the global row is enabled.
 *
 * Pure: callers load the rows. Keeps this testable with no database.
 */
export function resolveEnabledProviders(
  rows: ProviderRow[],
  available: SocialProviderId[],
  appId: number | null,
): SocialProviderId[] {
  const availableSet = new Set<string>(available);

  return PROVIDER_ORDER.filter((provider) => {
    if (!availableSet.has(provider)) return false;

    const globalRow = rows.find((r) => r.appId === null && r.provider === provider);
    if (!globalRow) return false;

    if (appId === null) return globalRow.enabled;

    const appRow = rows.find((r) => r.appId === appId && r.provider === provider);
    return appRow ? appRow.enabled : globalRow.enabled;
  });
}
