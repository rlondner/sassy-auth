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
    delete(args: { where: { id: number } }): Promise<unknown>;
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
 *
 * The same compensating-delete + APIError also fires on the eligible path if
 * either `db.saUser.create` or `db.saUserRole.create` throws (DB constraint
 * violation, transient error, etc) — eligibility was already confirmed, but
 * the orphaned BetterAuth User/Account row still needs cleaning up.
 *
 * Compensation order matters here: `SaUser.betterAuthUserId` has an
 * `ON DELETE RESTRICT` FK to `User` (see
 * packages/db/migrations/20260526054018_betterauth_init/migration.sql), so a
 * `User` row cannot be deleted while a referencing `SaUser` row still exists.
 * If `db.saUser.create` has already succeeded by the time something fails
 * (i.e. `db.saUserRole.create` throws), the `SaUser` row must be deleted
 * FIRST, before the compensating `db.user.delete`, or the latter would
 * itself fail with an FK violation and leave the User/Account/SaUser rows
 * all orphaned. `SaUserRole.userId` is `ON DELETE CASCADE` to `SaUser`, so
 * deleting `SaUser` is never itself blocked by a surviving `SaUserRole` row
 * — moot here anyway, since a throwing `saUserRole.create` never persisted
 * one. The `recordFederationEvent` audit call that runs after both creates
 * succeed is NOT covered by this compensation: an audit-only failure after
 * successful provisioning is a separate, already-accepted fire-and-forget
 * failure mode.
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

  let saUser: { id: number; publicId: string };
  try {
    saUser = await db.saUser.create({
      data: {
        publicId: input.betterAuthUserId.slice(0, 12),
        betterAuthUserId: input.betterAuthUserId,
        orgId: app.defaultOrgId!,
        firstName,
        lastName,
        status: 'active',
      },
    });
  } catch (err: unknown) {
    // Eligibility was already confirmed, but SaUser provisioning itself
    // failed (DB constraint violation, transient error, etc). No SaUser row
    // exists yet, so the compensating User delete can run directly — there
    // is nothing to conflict with the User->SaUser RESTRICT FK.
    logger.error('Eligible-path provisioning write failed; compensating', {
      context: 'provision-social-signup-user',
      betterAuthUserId: input.betterAuthUserId,
      err: String(err),
    });
    try {
      await db.user.delete({ where: { id: input.betterAuthUserId } });
    } catch (deleteErr: unknown) {
      logger.warn('Compensating delete failed after an eligible-path provisioning failure', {
        context: 'provision-social-signup-user',
        betterAuthUserId: input.betterAuthUserId,
        err: String(deleteErr),
      });
    }
    throw new APIError('BAD_REQUEST', { message: SOCIAL_SIGNUP_UNAVAILABLE_ERROR_CODE });
  }

  try {
    await db.saUserRole.create({ data: { userId: saUser.id, roleId: app.defaultRoleId! } });
  } catch (err: unknown) {
    // SaUser was already created, so the compensating User delete would hit
    // the ON DELETE RESTRICT FK from SaUser.betterAuthUserId -> User.id
    // unless the SaUser row is removed first. Delete SaUser, THEN User.
    logger.error('Eligible-path provisioning write failed; compensating', {
      context: 'provision-social-signup-user',
      betterAuthUserId: input.betterAuthUserId,
      err: String(err),
    });
    try {
      await db.saUser.delete({ where: { id: saUser.id } });
    } catch (deleteErr: unknown) {
      logger.warn('Compensating SaUser delete failed after an eligible-path provisioning failure', {
        context: 'provision-social-signup-user',
        betterAuthUserId: input.betterAuthUserId,
        err: String(deleteErr),
      });
    }
    try {
      await db.user.delete({ where: { id: input.betterAuthUserId } });
    } catch (deleteErr: unknown) {
      logger.warn('Compensating delete failed after an eligible-path provisioning failure', {
        context: 'provision-social-signup-user',
        betterAuthUserId: input.betterAuthUserId,
        err: String(deleteErr),
      });
    }
    throw new APIError('BAD_REQUEST', { message: SOCIAL_SIGNUP_UNAVAILABLE_ERROR_CODE });
  }

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
