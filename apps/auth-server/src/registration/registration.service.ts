import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { auth } from '../auth/auth.config';
import { SqidService } from '../common/sqid/sqid.service';
import { generatePendingPublicId } from '../common/pending-public-id';
import { RegisterDto } from './register.dto';

/**
 * BetterAuth (v1.6.x) throws an APIError instance when sign-up fails.
 * For a duplicate email (without requireEmailVerification), the error has:
 *   status: 'UNPROCESSABLE_ENTITY' (string) and statusCode: 422 (number)
 *   body.code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
 *
 * We detect it by checking the string status field rather than instanceof,
 * since the APIError class may not be easily importable in all environments.
 */
function isDuplicateEmailError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'status' in e &&
    (e as { status?: string }).status === 'UNPROCESSABLE_ENTITY'
  );
}

@Injectable()
export class RegistrationService {
  constructor(private readonly sqids: SqidService) {}

  async register(dto: RegisterDto): Promise<{ ok: true; orgPublicId: string }> {
    // 1. Resolve the app — 404 if unknown
    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appPublicId } });
    if (!app) throw new NotFoundException('App not found');

    // An app with a defaultOrgId places every self-serve signup into that
    // existing org — companyName is irrelevant and never read in that case.
    // Otherwise companyName is required to found a brand-new org, same as
    // before this feature existed.
    let defaultOrg: { id: number; publicId: string } | null = null;
    if (app.defaultOrgId) {
      // Guaranteed to exist by the FK (Restrict on delete) — no defensive
      // null-check needed beyond satisfying the type checker.
      defaultOrg = await prisma.saOrg.findUnique({
        where: { id: app.defaultOrgId },
        select: { id: true, publicId: true },
      });
    } else if (!dto.companyName?.trim()) {
      throw new BadRequestException('companyName is required');
    }

    // 2. Create the BetterAuth credential account (user row + scrypt-hashed password)
    let baUserId: string;
    try {
      const signUp = await auth.api.signUpEmail({
        body: { email: dto.email, password: dto.password, name: `${dto.firstName} ${dto.lastName}`.trim() },
      });
      baUserId = signUp.user.id;
    } catch (e: unknown) {
      if (isDuplicateEmailError(e)) {
        throw new ConflictException('email already registered');
      }
      throw e;
    }

    // `emailAndPassword.autoSignIn` is disabled (see auth.config.ts — a session
    // at sign-up can never pass the session-create gate). A side effect of that
    // flag is that BetterAuth no longer throws on a duplicate email: to avoid
    // leaking which addresses are registered, it returns a synthetic user whose
    // id was never written to the database. Taking that id at face value would
    // point an SaUser at a BetterAuth user that does not exist. The catch above
    // still handles the throwing shape, so both paths end in the same 409.
    const persisted = await prisma.user.findUnique({ where: { id: baUserId }, select: { id: true } });
    if (!persisted) {
      throw new ConflictException('email already registered');
    }

    // 3. Atomically create/resolve the org, create the saUser (always
    // 'unverified' — see auth.config.ts's emailVerification block), and
    // assign the app's default role if one is set.
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const org = await prisma.$transaction(async (tx: Tx) => {
        let targetOrg: { id: number; publicId: string };
        if (defaultOrg) {
          targetOrg = defaultOrg;
        } else {
          const draft = await tx.saOrg.create({
            // Non-null: reaching this branch means defaultOrg is null, which
            // only happens after the companyName presence check above threw
            // when it was missing — TS narrowing doesn't cross the closure
            // boundary into this transaction callback, so assert here.
            data: { publicId: generatePendingPublicId(), name: dto.companyName!, appId: app.id, isPlatform: false },
          });
          targetOrg = await tx.saOrg.update({
            where: { id: draft.id },
            data: { publicId: this.sqids.encode(draft.id) },
          });
        }
        const createdSaUser = await tx.saUser.create({
          data: {
            publicId: baUserId.slice(0, 12),
            betterAuthUserId: baUserId,
            orgId: targetOrg.id,
            firstName: dto.firstName,
            lastName: dto.lastName,
            status: 'unverified',
          },
        });
        if (app.defaultRoleId) {
          await tx.saUserRole.create({ data: { userId: createdSaUser.id, roleId: app.defaultRoleId } });
        }
        return targetOrg;
      });

      const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
      await auth.api.sendVerificationEmail({
        body: { email: dto.email, callbackURL: `${adminUrl}/signup/verified` },
      });

      return { ok: true as const, orgPublicId: org.publicId };
    } catch (e: unknown) {
      // Compensation: delete the BetterAuth user so the email can be re-used
      await prisma.user.delete({ where: { id: baUserId } }).catch(() => {
        // Swallow — we still re-throw the original error below
      });
      throw e;
    }
  }

  async getAppName(appPublicId: string): Promise<{ name: string; hasDefaultOrg: boolean }> {
    if (!appPublicId) throw new NotFoundException('App not found');
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: { name: true, defaultOrgId: true },
    });
    if (!app) throw new NotFoundException('App not found');
    return { name: app.name, hasDefaultOrg: app.defaultOrgId !== null };
  }
}
