import type { ConsentDocumentType } from '@sassy-auth/types';
import { resolveRequiredConsent, type ConsentAppUrls, type RequiredConsentDocument } from './resolve-required-consent';

export interface ConsentReadClient {
  saUserConsent: {
    findMany(args: {
      where: { saUserId: number; appId: number };
      select: { documentType: true };
    }): Promise<Array<{ documentType: string }>>;
  };
}

/**
 * Which of this app's currently-required documents this SaUser has NOT yet
 * accepted for this app. A document's mere presence in SaUserConsent means
 * permanent acceptance — see resolveRequiredConsent's countryCode handling
 * for how GDPR applicability is decided per-request.
 */
export async function resolveOutstandingConsent(
  db: ConsentReadClient,
  saUserId: number,
  appId: number,
  app: ConsentAppUrls,
  countryCode: string | null,
): Promise<RequiredConsentDocument[]> {
  const required = resolveRequiredConsent(app, countryCode);
  if (required.length === 0) return [];
  const existing = await db.saUserConsent.findMany({
    where: { saUserId, appId },
    select: { documentType: true },
  });
  const acceptedTypes = new Set(existing.map((e) => e.documentType as ConsentDocumentType));
  return required.filter((doc) => !acceptedTypes.has(doc.documentType));
}
