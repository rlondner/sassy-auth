import { resolveOutstandingConsent } from './resolve-outstanding-consent';

describe('resolveOutstandingConsent', () => {
  function fakeDb(existingDocumentTypes: string[]) {
    return {
      saUserConsent: {
        findMany: jest.fn().mockResolvedValue(existingDocumentTypes.map((documentType) => ({ documentType }))),
      },
    };
  }

  const app = {
    privacyPolicyUrl: 'https://a.example.com/privacy',
    termsUrl: 'https://a.example.com/terms',
    gdprUrl: 'https://a.example.com/gdpr',
  };

  it('returns every required document when none have been accepted yet', async () => {
    const db = fakeDb([]);
    const result = await resolveOutstandingConsent(db, 1, 10, app, 'DE');
    expect(result).toEqual([
      { documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
      { documentType: 'terms', url: 'https://a.example.com/terms' },
      { documentType: 'gdpr', url: 'https://a.example.com/gdpr' },
    ]);
    expect(db.saUserConsent.findMany).toHaveBeenCalledWith({
      where: { saUserId: 1, appId: 10 },
      select: { documentType: true },
    });
  });

  it('excludes documents that already have a SaUserConsent row', async () => {
    const db = fakeDb(['privacy_policy']);
    const result = await resolveOutstandingConsent(db, 1, 10, app, 'DE');
    expect(result).toEqual([
      { documentType: 'terms', url: 'https://a.example.com/terms' },
      { documentType: 'gdpr', url: 'https://a.example.com/gdpr' },
    ]);
  });

  it('returns an empty array once every required document has been accepted', async () => {
    const db = fakeDb(['privacy_policy', 'terms', 'gdpr']);
    const result = await resolveOutstandingConsent(db, 1, 10, app, 'DE');
    expect(result).toEqual([]);
  });

  it('never requires gdpr for a non-applicable country, regardless of existing rows', async () => {
    const db = fakeDb([]);
    const result = await resolveOutstandingConsent(db, 1, 10, app, 'US');
    expect(result).toEqual([
      { documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
      { documentType: 'terms', url: 'https://a.example.com/terms' },
    ]);
  });
});
