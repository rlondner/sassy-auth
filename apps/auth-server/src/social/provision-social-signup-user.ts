import { APIError } from 'better-auth/api';
import { resolveSocialSignupEligibility } from './resolve-social-signup-eligibility';
import { deriveSignupName } from './derive-signup-name';
import { recordFederationEvent } from './record-federation-event';
import { createAppLogger } from '../common/logger/winston.config';
import { SOCIAL_SIGNUP_UNAVAILABLE_ERROR_CODE } from './classify-callback-outcome';

export interface ProvisionSocialSignupDb {
  saApp: {
    findUnique(args: { where: { publicId: string } }): Promise<{
      id: number;
      publicId: string;
      defaultOrgId: number | null;
      defaultRoleId: number | null;
    } | null>;
  };
  saUser: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: number; publicId: string }>;
  };
  saUserRole: {
    create(args: { data: { userId: number; roleId: number } }): Promise<unknown>;
  };
  user: {
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  saAuditEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface ProvisionSocialSignupInput {
  betterAuthUserId: string;
  email: string;
  name: string;
  provider: string;
  /** From social-signup-context.ts — null means unresolvable, treated as ineligible. */
  clientId: string | null;
  givenName: string | null;
  familyName: string | null;
}

const logger = createAppLogger();

/**
 * Design doc §2-§4: the databaseHooks.user.create.after hook's eligibility
 * decision and the two outcomes it drives. Called once per first-time
 * social identity, AFTER BetterAuth has already committed the User/Account
 * row (see design doc §3a) — a delete here is a compensating delete, never
 * a rollback.
 *
 * Throws an APIError('BAD_REQUEST', { message: SOCIAL_SIGNUP_UNAVAILABLE_ERROR_CODE })
 * on the ineligible path — see design doc §3a for why this specific message
 * string, unchanged by better-auth's callback.mjs error-code transform,
 * reaches classify-callback-outcome.ts as a real FOUND redirect rather than
 * a raw error status.
 */
export async function provisionSocialSignupUser(
  db: ProvisionSocialSignupDb,
  input: ProvisionSocialSignupInput,
): Promise<void> {
  const app = input.clientId ? await db.saApp.findUnique({ where: { publicId: input.clientId } }) : null;

  if (!app || !resolveSocialSignupEligibility(app)) {
    try {
      await db.user.delete({ where: { id: input.betterAuthUserId } });
    } catch (err: unknown) {
      logger.warn('Compensating delete failed for an ineligible social signup', {
        context: 'provision-social-signup-user',
        betterAuthUserId: input.betterAuthUserId,
        err: String(err),
      });
    }
    throw new APIError('BAD_REQUEST', { message: SOCIAL_SIGNUP_UNAVAILABLE_ERROR_CODE });
  }

  const { firstName, lastName } = deriveSignupName({
    name: input.name,
    givenName: input.givenName,
    familyName: input.familyName,
  });

  const saUser = await db.saUser.create({
    data: {
      publicId: input.betterAuthUserId.slice(0, 12),
      betterAuthUserId: input.betterAuthUserId,
      orgId: app.defaultOrgId!,
      firstName,
      lastName,
      status: 'active',
    },
  });

  await db.saUserRole.create({ data: { userId: saUser.id, roleId: app.defaultRoleId! } });

  await recordFederationEvent(
    { db, logger },
    {
      type: 'social.signup.created',
      provider: input.provider,
      saUserId: saUser.id,
      saUserPublicId: saUser.publicId,
      betterAuthUserId: input.betterAuthUserId,
      appPublicId: app.publicId,
      email: input.email,
    },
  );
}
