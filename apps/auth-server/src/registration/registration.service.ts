import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { PasswordPolicy } from '@sassy-auth/types';
import { auth } from '../auth/auth.config';
import { SqidService } from '../common/sqid/sqid.service';
import { generatePendingPublicId } from '../common/pending-public-id';
import { resolvePasswordPolicy, validatePasswordOrThrow } from '../auth/password-policy';
import { RegisterDto } from './register.dto';
import { TurnstileService } from './turnstile.service';
import { OauthService } from '../token/oauth.service';

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
  constructor(
    private readonly sqids: SqidService,
    private readonly turnstile: TurnstileService,
    private readonly oauthService: OauthService,
  ) {}

  async register(dto: RegisterDto): Promise<{ ok: true; orgPublicId: string; redirectUrl?: string }> {
    // 0. Verify the captcha before any app lookup or DB work
    const captchaOk = await this.turnstile.verify(dto.turnstileToken);
    if (!captchaOk) {
      throw new UnprocessableEntityException('captcha verification failed');
    }

    // 1. Resolve the app — 404 if unknown
    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appPublicId } });
    if (!app) throw new NotFoundException('App not found');

    // Resolve and enforce the app's effective password policy before ever
    // touching BetterAuth — a rejected password must not create any account.
    validatePasswordOrThrow(dto.password, resolvePasswordPolicy(app));

    // An app with a defaultOrgId places every self-serve signup into that
    // existing org — companyName is irrelevant and never read in that case.
    // Otherwise companyName is required to found a brand-new org, same as
    // before this feature existed.
    let defaultOrg: { id: number; publicId: string } | null = null;
    if (app.defaultOrgId) {
      // The FK (Restrict on delete) makes this unreachable in normal
      // operation, but a loud 404 here is cheap insurance against silently
      // creating an org named "undefined" if that invariant is ever violated.
      defaultOrg = await prisma.saOrg.findUnique({
        where: { id: app.defaultOrgId },
        select: { id: true, publicId: true },
      });
      if (!defaultOrg) {
        throw new NotFoundException('Default org not found');
      }
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
      const { org, saUserPublicId } = await prisma.$transaction(async (tx: Tx) => {
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
        return { org: targetOrg, saUserPublicId: createdSaUser.publicId };
      });

      const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
      await auth.api.sendVerificationEmail({
        body: { email: dto.email, callbackURL: `${adminUrl}/signup/verified` },
      });

      // Authenticate the new (still-pending) user against the target app
      // immediately, so it can redirect back with a working access token
      // instead of waiting for email verification. Only possible when the
      // app is confidential (has a client secret) and has a registered
      // login redirect URI: a code minted here carries no PKCE challenge
      // (there was no /authorize request to negotiate one), and /api/token
      // refuses a challenge-less code from a public client.
      let redirectUrl: string | undefined;
      if (app.clientSecretHash) {
        // When an app has multiple registered login redirect URIs, there's no
        // per-request way to indicate which one signup should target — pick
        // the oldest-registered one deterministically.
        const loginRedirect = await prisma.saAppRedirectUri.findFirst({
          where: { appId: app.id, kind: 'login' },
          orderBy: { id: 'asc' },
        });
        if (loginRedirect) {
          const code = await this.oauthService.generateCode(
            saUserPublicId,
            app.publicId,
            loginRedirect.uri,
            null,
            null,
            ['signup'],
            null,
            'openid profile email',
            new Date(),
          );
          const url = new URL(loginRedirect.uri);
          url.searchParams.set('code', code);
          redirectUrl = url.toString();
        }
      }

      return { ok: true as const, orgPublicId: org.publicId, ...(redirectUrl !== undefined && { redirectUrl }) };
    } catch (e: unknown) {
      // Compensation: delete the BetterAuth user so the email can be re-used
      await prisma.user.delete({ where: { id: baUserId } }).catch(() => {
        // Swallow — we still re-throw the original error below
      });
      throw e;
    }
  }

  async getAppName(
    appPublicId: string,
  ): Promise<{ name: string; hasDefaultOrg: boolean; passwordPolicy: PasswordPolicy }> {
    if (!appPublicId) throw new NotFoundException('App not found');
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: { name: true, defaultOrgId: true, passwordPolicyOverride: true },
    });
    if (!app) throw new NotFoundException('App not found');
    return {
      name: app.name,
      hasDefaultOrg: app.defaultOrgId !== null,
      passwordPolicy: resolvePasswordPolicy(app),
    };
  }
}
