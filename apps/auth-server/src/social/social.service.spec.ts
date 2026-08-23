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

describe('SocialService.setForApp', () => {
  it('upserts an app row per available provider, enabled or not', async () => {
    const upserts: { where: unknown; create: unknown; update: unknown }[] = [];
    const db = {
      saApp: { findUnique: async () => ({ id: 7 }) },
      saSocialProvider: {
        findMany: async () => [],
        upsert: async (args: { where: unknown; create: unknown; update: unknown }) => {
          upserts.push(args);
        },
      },
    };
    const svc = new SocialService(db as never, {
      GOOGLE_CLIENT_ID: 'g',
      GOOGLE_CLIENT_SECRET: 's',
      MICROSOFT_CLIENT_ID: 'm',
      MICROSOFT_CLIENT_SECRET: 's',
    });

    await svc.setForApp('qp31', ['google']);

    expect(upserts).toHaveLength(2);
    expect(upserts.map((u) => (u.update as { enabled: boolean }).enabled)).toEqual([true, false]);
  });

  it('throws for an unknown app rather than creating orphan rows', async () => {
    const db = {
      saApp: { findUnique: async () => null },
      saSocialProvider: { findMany: async () => [], upsert: async () => undefined },
    };
    const svc = new SocialService(db as never, {});
    await expect(svc.setForApp('nope', [])).rejects.toThrow();
  });
});
