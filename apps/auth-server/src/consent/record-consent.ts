import type { RequiredConsentDocument } from './resolve-required-consent';

export interface ConsentWriteClient {
  saUserConsent: {
    createMany(args: {
      data: Array<{ saUserId: number; appId: number; documentType: string; url: string }>;
    }): Promise<unknown>;
  };
}

/**
 * Write one SaUserConsent row per accepted document. Accepts any client
 * that implements ConsentWriteClient — a plain `prisma` for a standalone
 * write, or a `tx` client inside a `prisma.$transaction` callback (see
 * registration.service.ts's use of the same pattern for SaUser creation).
 */
export async function recordConsent(
  db: ConsentWriteClient,
  saUserId: number,
  appId: number,
  documents: RequiredConsentDocument[],
): Promise<void> {
  if (documents.length === 0) return;
  await db.saUserConsent.createMany({
    data: documents.map((doc) => ({ saUserId, appId, documentType: doc.documentType, url: doc.url })),
  });
}
