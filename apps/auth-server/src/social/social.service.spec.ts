import { SocialService } from './social.service';

function makeService(rows: { appId: number | null; provider: string; enabled: boolean }[], app: { id: number } | null) {
  const db = {
    saApp: { findUnique: async () => app },
    saSocialProvider: { findMany: async () => rows },
  };
  return new SocialService(db as never, { GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' });
}

describe('SocialService.listForApp', () => {
  it('lists the providers enabled for a known app', async () => {
    const svc = makeService([{ appId: null, provider: 'google', enabled: true }], { id: 7 });
    await expect(svc.listForApp('qp31')).resolves.toEqual(['google']);
  });

  it('returns an empty list for an unknown client_id rather than throwing', async () => {
    const svc = makeService([{ appId: null, provider: 'google', enabled: true }], null);
    await expect(svc.listForApp('nope')).resolves.toEqual([]);
  });

  it('returns the global defaults when no client_id is given', async () => {
    const svc = makeService([{ appId: null, provider: 'google', enabled: true }], null);
    await expect(svc.listForApp(undefined)).resolves.toEqual(['google']);
  });

  it('honours an app-level opt-out', async () => {
    const svc = makeService(
      [
        { appId: null, provider: 'google', enabled: true },
        { appId: 7, provider: 'google', enabled: false },
      ],
      { id: 7 },
    );
    await expect(svc.listForApp('qp31')).resolves.toEqual([]);
  });
});
