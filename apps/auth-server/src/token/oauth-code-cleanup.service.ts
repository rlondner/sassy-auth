import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { LoggerService } from '../common/logger/logger.service';

// bug-0220: bug-0039 moved OAuth authorization codes out of an in-memory Map
// and into `SaOauthCode` so the auth-server can run several replicas. The
// exchange path deletes a row when it consumes it, but every abandoned flow —
// a user who closes the tab at the consent step, a client that never comes
// back for the token — leaves a row behind that nothing ever removes. The
// schema comment acknowledged this ("periodic cleanup job is optional, not
// shipped in v1"). At a few thousand OAuth starts a day that is millions of
// dead rows a year, slowing inserts and wasting storage.
//
// This is a plain interval rather than `@nestjs/schedule` / `@Cron` to avoid
// pulling in a new dependency for one job. With multiple replicas every
// instance sweeps, which is harmless: `deleteMany` on already-expired rows is
// idempotent and the losers of the race simply delete nothing.
export const OAUTH_CODE_SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class OauthCodeCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly logger: LoggerService) {}

  onModuleInit(): void {
    // Under NODE_ENV=test the suites drive `sweep()` directly; an interval
    // left running would be a stray open handle in every test process (and
    // the same reason the throttler buckets are neutered in test).
    if (process.env.NODE_ENV === 'test') return;

    // Sweep once at boot so a long-stopped deployment does not wait a full
    // interval before clearing whatever piled up while it was down.
    void this.sweep();

    this.timer = setInterval(() => {
      void this.sweep();
    }, OAUTH_CODE_SWEEP_INTERVAL_MS);

    // Never let the sweep hold the event loop open — on SIGTERM the process
    // must exit once Nest's shutdown hooks have run, not up to 15 minutes
    // later.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Delete every authorization code whose TTL has already elapsed. Returns the
   * number of rows removed. Never rejects: it runs from a timer with no caller
   * to catch it, so a transient DB failure must not become an unhandled
   * rejection that takes the auth-server down.
   */
  async sweep(): Promise<number> {
    try {
      const { count } = await prisma.saOauthCode.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) {
        this.logger.getWinstonLogger().info(`Removed ${count} expired OAuth code rows`, {
          context: 'OauthCodeCleanupService',
          removed: count,
        });
      }
      return count;
    } catch (err) {
      this.logger.getWinstonLogger().warn('Expired OAuth code cleanup failed', {
        context: 'OauthCodeCleanupService',
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  /** Test seam: asserts the interval is not keeping the process alive. */
  timerHasRef(): boolean {
    return this.timer?.hasRef() ?? false;
  }
}
