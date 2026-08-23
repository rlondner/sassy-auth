import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { availableSocialProviders } from './build-social-providers';
import { resolveEnabledProviders, type SocialProviderId } from './resolve-enabled-providers';

type Db = {
  saApp: { findUnique(args: unknown): Promise<{ id: number } | null> };
  saSocialProvider: {
    findMany(args?: unknown): Promise<{ appId: number | null; provider: string; enabled: boolean }[]>;
    upsert(args: unknown): Promise<unknown>;
  };
};

@Injectable()
export class SocialService {
  constructor(
    private readonly db: Db = prisma as unknown as Db,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /**
   * Which provider buttons an app's login screen renders.
   *
   * An unknown client_id resolves to the global defaults' shape but with no
   * app row applied, and never 404s — a 404 here would let anyone enumerate
   * which app public IDs exist.
   */
  async listForApp(clientId: string | undefined): Promise<SocialProviderId[]> {
    const app = clientId
      ? await this.db.saApp.findUnique({ where: { publicId: clientId }, select: { id: true } })
      : null;

    const rows = await this.db.saSocialProvider.findMany({
      where: { OR: [{ appId: null }, ...(app ? [{ appId: app.id }] : [])] },
      select: { appId: true, provider: true, enabled: true },
    });

    if (clientId && !app) return [];

    return resolveEnabledProviders(rows, availableSocialProviders(this.env), app?.id ?? null);
  }

  /**
   * Replace an app's provider opt-ins. Writes a row for EVERY available
   * provider — enabled or disabled — so an explicit "off" survives a later
   * change to the global default.
   */
  async setForApp(clientId: string, enabled: string[]): Promise<void> {
    const app = await this.db.saApp.findUnique({
      where: { publicId: clientId },
      select: { id: true },
    });
    if (!app) throw new NotFoundException('App not found');

    const wanted = new Set(enabled);
    for (const provider of availableSocialProviders(this.env)) {
      await this.db.saSocialProvider.upsert({
        where: { appId_provider: { appId: app.id, provider } },
        create: { appId: app.id, provider, enabled: wanted.has(provider) },
        update: { enabled: wanted.has(provider) },
      });
    }
  }
}
