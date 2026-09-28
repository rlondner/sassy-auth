import { recordConsent } from './record-consent';

describe('recordConsent', () => {
  it('does nothing when there are no documents to record', async () => {
    const db = { saUserConsent: { createMany: jest.fn() } };
    await recordConsent(db, 1, 10, []);
    expect(db.saUserConsent.createMany).not.toHaveBeenCalled();
  });

  it('writes one row per accepted document, carrying its url snapshot', async () => {
    const db = { saUserConsent: { createMany: jest.fn().mockResolvedValue({ count: 2 }) } };
    await recordConsent(db, 1, 10, [
      { documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
      { documentType: 'gdpr', url: 'https://a.example.com/gdpr' },
    ]);
    expect(db.saUserConsent.createMany).toHaveBeenCalledWith({
      data: [
        { saUserId: 1, appId: 10, documentType: 'privacy_policy', url: 'https://a.example.com/privacy' },
        { saUserId: 1, appId: 10, documentType: 'gdpr', url: 'https://a.example.com/gdpr' },
      ],
    });
  });
});
