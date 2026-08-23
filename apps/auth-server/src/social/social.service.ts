import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { availableSocialProviders } from './build-social-providers';
import { resolveEnabledProviders, type SocialProviderId } from './resolve-enabled-providers';

type Db = {
  saApp: { findUnique(args: unknown): Promise<{ id: number; isPlatform?: boolean } | null> };
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
   *
   * Mirrors AppsService.updateApp/deleteApp: the platform app's identity
   * providers cannot be repointed through this endpoint, exactly like its
   * name/url/callbackUrl/2FA settings — same `ForbiddenException` message,
   * same reasoning (the console hides the Edit action for the platform app,
   * but that is only a UI nicety; the API must refuse the write directly so
   * a raw HTTP call can't bypass it).
   */
  async setForApp(clientId: string, enabled: string[]): Promise<void> {
    const app = await this.db.saApp.findUnique({
      where: { publicId: clientId },
      select: { id: true, isPlatform: true },
    });
    if (!app) throw new NotFoundException('App not found');
    if (app.isPlatform) throw new ForbiddenException('Platform app cannot be modified');

    const wanted = new Set(enabled);
    for (const provider of availableSocialProviders(this.env)) {
      await this.db.saSocialProvider.upsert({
        where: { appId_provider: { appId: app.id, provider } },
        create: { appId: app.id, provider, enabled: wanted.has(provider) },
        update: { enabled: wanted.has(provider) },
      });
    }
  }

  /**
   * Backing data for the admin console's checkbox group: `available` is
   * every provider this deployment has credentials for (regardless of
   * whether any app currently shows it), `enabled` is the subset this app
   * currently shows. The console ticks a checkbox when it appears in
   * `enabled` and renders one row per entry in `available` — so a provider
   * an app previously opted out of (or one enabled globally but off for
   * this app) is still selectable, closing the opt-in gap `listForApp` /
   * the public GET can't fix (see class doc on the controller route).
   *
   * Read-only, so — unlike `setForApp` — it is NOT blocked for the platform
   * app: `AppsService.getApp`/`listApps` allow reading the platform app's
   * settings, only its mutating routes (`updateApp`/`deleteApp`) refuse.
   * This endpoint is authenticated (unlike the public GET), so an unknown
   * clientId 404s rather than silently returning an empty list — there is
   * no enumeration concern once the caller already holds
   * `platform.apps.manage`.
   */
  async getSettingsForApp(clientId: string): Promise<{ available: SocialProviderId[]; enabled: SocialProviderId[] }> {
    const app = await this.db.saApp.findUnique({
      where: { publicId: clientId },
      select: { id: true },
    });
    if (!app) throw new NotFoundException('App not found');

    return {
      available: availableSocialProviders(this.env),
      enabled: await this.listForApp(clientId),
    };
  }
}
