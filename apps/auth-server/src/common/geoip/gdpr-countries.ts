/**
 * Fixed set of ISO 3166-1 alpha-2 country codes GDPR-equivalent consent
 * applies to: the 27 EU member states, the non-EU EEA states (Iceland,
 * Liechtenstein, Norway), the United Kingdom (UK GDPR), and Switzerland
 * (FADP, commonly bundled with GDPR handling in practice). Not
 * admin-configurable in this iteration — see
 * docs/superpowers/specs/2026-09-22-signup-legal-consent-design.md.
 */
const GDPR_COUNTRIES: ReadonlySet<string> = new Set([
  // EU27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  // EEA (non-EU)
  'IS', 'LI', 'NO',
  // UK + Switzerland
  'GB', 'CH',
]);

export function isGdprCountry(countryCode: string): boolean {
  return GDPR_COUNTRIES.has(countryCode.toUpperCase());
}
