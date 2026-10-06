import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { LoggerService } from '../common/logger/logger.service';

// A user who completes step 1 of the code-first signup wizard
// (startRegistration — see registration.service.ts) gets a real BetterAuth
// account with a placeholder password immediately, before ever verifying
// their email. One who never returns leaves that account behind forever
// unless something sweeps it. Same plain-interval rationale as
// OauthCodeCleanupService (../token/oauth-code-cleanup.service.ts): every
// replica sweeps, which is harmless since deleteMany on already-stale rows
// is idempotent.
export const ABANDONED_SIGNUP_SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
export const ABANDONED_SIGNUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class AbandonedSignupCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly logger: LoggerService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;

    void this.sweep();

    this.timer = setInterval(() => {
      void this.sweep();
    }, ABANDONED_SIGNUP_SWEEP_INTERVAL_MS);

    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Delete every BetterAuth user that is unverified, has no linked SaUser
   * (i.e. never made it past startRegistration), and is older than the TTL.
   * Returns the number of rows removed. Never rejects — runs from a timer
   * with no caller to catch it.
   */
  async sweep(): Promise<number> {
    try {
      // Safe to delete unconditionally on this shape: see registration.service.ts's
      // startRegistration comment for the proof that no other flow (social sign-in,
      // magic-link, invitations) can produce a User row with emailVerified:false and
      // no SaUser.
      const { count } = await prisma.user.deleteMany({
        where: {
          emailVerified: false,
          saUser: null,
          createdAt: { lt: new Date(Date.now() - ABANDONED_SIGNUP_TTL_MS) },
        },
      });
      if (count > 0) {
        this.logger.getWinstonLogger().info(`Removed ${count} abandoned signup account(s)`, {
          context: 'AbandonedSignupCleanupService',
          removed: count,
        });
      }
      return count;
    } catch (err) {
      this.logger.getWinstonLogger().warn('Abandoned signup cleanup failed', {
        context: 'AbandonedSignupCleanupService',
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
