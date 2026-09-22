import type { ConsentDocumentType } from '@sassy-auth/types';
import { isGdprCountry } from '../common/geoip/gdpr-countries';

export interface ConsentAppUrls {
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  gdprUrl: string | null;
}

export interface RequiredConsentDocument {
  documentType: ConsentDocumentType;
  url: string;
}

/**
 * Which documents this app currently requires acceptance of, for a request
 * resolved to `countryCode` (or `null` if it could not be resolved).
 * Privacy Policy and Terms are geo-independent — outstanding whenever their
 * URL is configured. GDPR additionally requires the country to be
 * GDPR-applicable; a `null` countryCode (unresolved) fails closed and is
 * treated as applicable — see geoip.service.ts and
 * docs/superpowers/specs/2026-09-22-signup-legal-consent-design.md.
 */
export function resolveRequiredConsent(
  app: ConsentAppUrls,
  countryCode: string | null,
): RequiredConsentDocument[] {
  const required: RequiredConsentDocument[] = [];
  if (app.privacyPolicyUrl) required.push({ documentType: 'privacy_policy', url: app.privacyPolicyUrl });
  if (app.termsUrl) required.push({ documentType: 'terms', url: app.termsUrl });
  if (app.gdprUrl && (countryCode === null || isGdprCountry(countryCode))) {
    required.push({ documentType: 'gdpr', url: app.gdprUrl });
  }
  return required;
}
