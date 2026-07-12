import { signInCodeEmail } from '../email/templates/sign-in-code.template';

export interface OtpSenderDb {
  saUser: {
    findFirst(args: {
      where: { betterAuthUser: { email: string } };
      select: { status: true };
    }): Promise<{ status: string } | null>;
  };
}

export interface SendOtpDeps {
  db: OtpSenderDb;
  emailer: { send(msg: { to: string; subject: string; html: string; text: string }): Promise<{ sent: boolean }> };
  store: { set(email: string, otp: string): void };
  logger: { info(msg: string, meta: Record<string, unknown>): void };
  isTest: boolean;
}

const OTP_EXPIRY_MINUTES = 5;

/**
 * Deliver a sign-in OTP through EmailService, but only to existing, active
 * users. Non-active/unknown users get no email (the admin action keeps the
 * HTTP response neutral regardless). The OTP value is never logged (bug-0163).
 */
export async function sendSignInOtp(
  deps: SendOtpDeps,
  data: { email: string; otp: string; type: string },
): Promise<void> {
  const { db, emailer, store, logger, isTest } = deps;
  const { email, otp, type } = data;

  if (type === 'sign-in') {
    const saUser = await db.saUser.findFirst({
      where: { betterAuthUser: { email } },
      select: { status: true },
    });
    if (!saUser || saUser.status !== 'active') {
      logger.info('Sign-in code requested', {
        context: 'auth-otp',
        email,
        outcome: saUser ? 'skipped_inactive' : 'skipped_unknown',
      });
      return;
    }
  }

  // Test-only: record the code so the env-guarded endpoint (Task 4) can return
  // it to the e2e suite. Synchronous so it is readable the moment the
  // send-verification-otp request resolves.
  if (isTest) store.set(email, otp);

  // Fire-and-forget the delivery (BetterAuth recommends not awaiting to avoid
  // timing attacks). Delivery failures are reported to Sentry inside
  // EmailService; a rejected promise here must not crash the request.
  void emailer
    .send({ to: email, ...signInCodeEmail({ otp, minutes: OTP_EXPIRY_MINUTES }) })
    .catch(() => {});

  logger.info('Sign-in code requested', { context: 'auth-otp', email, outcome: 'sent' });
}
