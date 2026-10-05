import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { prisma } from '@sassy-auth/db';
import { PasswordPolicy } from '@sassy-auth/types';
import type { ActivationEmailBranding } from '@sassy-auth/types';
import { randomBytes, randomUUID } from 'crypto';
import { auth } from '../auth/auth.config';
import { SqidService } from '../common/sqid/sqid.service';
import { generatePendingPublicId } from '../common/pending-public-id';
import { resolvePasswordPolicy, validatePasswordOrThrow } from '../auth/password-policy';
import { getEmailer } from '../email/email.singleton';
import { sendVerificationCode } from '../auth/verification-code-sender';
import { notifyActivation } from '../activation/notify-activation';
import {
  CompleteRegistrationDto,
  RegisterDto,
  StartRegistrationDto,
  VerifyRegistrationCodeDto,
} from './register.dto';
import { TurnstileService } from './turnstile.service';
import { OauthService } from '../token/oauth.service';
import { resolveRequiredConsent } from '../consent/resolve-required-consent';
import { recordConsent } from '../consent/record-consent';
import { resolveCountryFromIp } from '../common/geoip/geoip.service';
import { assertRedirectUriAllowed } from '../token/redirect-uri';
import { OAUTH_AUTHORIZE_PATH } from '../token/oauth-metadata';

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

interface RecoveredAuthorizeParams {
  redirectUri: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  state: string | null;
  nonce: string | null;
}

/**
 * Recovers the original /authorize request's parameters from the `next` URL
 * the admin signup page was bounced here with, so a signup-flow code can be
 * bound to the same PKCE challenge (public clients) and carry the same
 * state/nonce (both client types) the relying party is waiting on. Returns
 * null for anything that doesn't name this app's /authorize path with a
 * matching client_id and a redirect_uri — every caller must treat that as
 * "no redirect is possible", never as an error worth failing registration
 * over. Deliberately does not check next's origin/host: the caller still
 * validates the recovered redirect_uri against the app's registered set via
 * assertRedirectUriAllowed, which is the actual security boundary here.
 */
function recoverAuthorizeParams(
  next: string | undefined,
  appPublicId: string,
): RecoveredAuthorizeParams | null {
  if (!next) return null;
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    return null;
  }
  if (url.pathname !== OAUTH_AUTHORIZE_PATH) return null;
  if (url.searchParams.get('client_id') !== appPublicId) return null;
  const redirectUri = url.searchParams.get('redirect_uri');
  if (!redirectUri) return null;
  return {
    redirectUri,
    codeChallenge: url.searchParams.get('code_challenge'),
    codeChallengeMethod: url.searchParams.get('code_challenge_method'),
    state: url.searchParams.get('state'),
    nonce: url.searchParams.get('nonce'),
  };
}

@Injectable()
export class RegistrationService {
  constructor(
    private readonly sqids: SqidService,
    private readonly turnstile: TurnstileService,
    private readonly oauthService: OauthService,
  ) {}

  async register(
    dto: RegisterDto,
    ip: string = 'unknown',
  ): Promise<{ ok: true; orgPublicId: string; redirectUrl?: string }> {
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

    // Resolve required consent against THIS request's IP — never trust
    // whatever the earlier GET /api/register/app call computed.
    const country = resolveCountryFromIp(ip);
    const requiredConsent = resolveRequiredConsent(app, country);
    for (const doc of requiredConsent) {
      // Field names mirror the DTO's accepted<X> booleans (camelCase), not
      // the underlying documentType (snake_case) — used in the error
      // message below so it names what the caller must actually send.
      const field = doc.documentType === 'privacy_policy' ? 'privacyPolicy'
        : doc.documentType === 'terms' ? 'terms'
        : 'gdpr';
      const accepted = doc.documentType === 'privacy_policy' ? dto.acceptedPrivacyPolicy
        : doc.documentType === 'terms' ? dto.acceptedTerms
        : dto.acceptedGdpr;
      if (accepted !== true) {
        throw new BadRequestException(`You must accept the ${field} before signing up`);
      }
    }

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

    return this.finishRegistration({
      app,
      baUserId,
      dto: { firstName: dto.firstName, lastName: dto.lastName, companyName: dto.companyName, next: dto.next },
      defaultOrg,
      requiredConsent,
      saUserStatus: 'unverified',
      sendLinkVerificationEmail: true,
      email: dto.email,
    });
  }

  /**
   * Shared by register() ('link'-method apps, and 'code'-method apps that
   * call POST /api/register directly rather than going through the
   * code-first wizard) and completeRegistration() (the wizard's final step,
   * where the email is already verified — see its own doc comment for why
   * `saUserStatus`/`sendLinkVerificationEmail` differ there). Creates the
   * org/SaUser/consent atomically, optionally sends the link-verification
   * email, and mints a signup-flow OAuth code to redirect back to the
   * relying app — identical logic to what register() always ran inline
   * before this method existed.
   */
  private async finishRegistration(args: {
    app: NonNullable<Awaited<ReturnType<typeof prisma.saApp.findUnique>>>;
    baUserId: string;
    dto: { firstName: string; lastName: string; companyName?: string; next?: string; marketingOptIn?: boolean };
    defaultOrg: { id: number; publicId: string } | null;
    requiredConsent: ReturnType<typeof resolveRequiredConsent>;
    saUserStatus: 'unverified' | 'active';
    sendLinkVerificationEmail: boolean;
    email: string;
  }): Promise<{ ok: true; orgPublicId: string; redirectUrl?: string }> {
    const { app, baUserId, dto, defaultOrg, requiredConsent, saUserStatus, sendLinkVerificationEmail, email } = args;
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const { org, saUserId, saUserPublicId } = await prisma.$transaction(async (tx: Tx) => {
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
            status: saUserStatus,
            // register() never supplies marketingOptIn — omit the key
            // entirely here rather than defaulting it, so register()'s
            // saUser.create call shape (and its existing exact-match tests)
            // stay unchanged; completeRegistration applies its own
            // `?? false` default before calling this.
            ...(dto.marketingOptIn !== undefined ? { marketingOptIn: dto.marketingOptIn } : {}),
          },
        });
        if (app.defaultRoleId) {
          await tx.saUserRole.create({ data: { userId: createdSaUser.id, roleId: app.defaultRoleId } });
        }
        await recordConsent(tx, createdSaUser.id, app.id, requiredConsent);
        return { org: targetOrg, saUserId: createdSaUser.id, saUserPublicId: createdSaUser.publicId };
      });

      if (sendLinkVerificationEmail) {
        const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
        await auth.api.sendVerificationEmail({
          body: { email, callbackURL: `${adminUrl}/signup/verified?email=${encodeURIComponent(email)}` },
        });
      } else {
        // The email was already verified before this SaUser existed, so
        // auth.config.ts's afterEmailVerification hook never ran for it
        // (its `updateMany({ where: { status: 'unverified' } })` found no
        // row to promote) — fire the activation webhook explicitly here
        // instead, since this is the one code path that transitions
        // straight to 'active' without going through that hook.
        await notifyActivation({
          id: saUserId,
          publicId: saUserPublicId,
          orgId: org.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email,
        });
      }

      // Authenticate the new (still-pending) user against the target app
      // immediately, so it can redirect back with a working access token
      // instead of waiting for email verification. `dto.next` — when
      // present — is the original /authorize URL the admin signup page was
      // bounced here from, carrying the redirect_uri/code_challenge/
      // state/nonce the relying party is waiting on. A public client's code
      // MUST be bound to that challenge (PKCE is its only defense against
      // code interception); a confidential client's client secret provides
      // the same protection, so its challenge is optional and, absent a
      // usable `next`, falls back to the oldest registered login redirect
      // URI with no challenge at all. Every validation failure below is
      // silent — it never fails registration itself, it just narrows what
      // redirect (if any) comes back.
      const isConfidential = Boolean(app.clientSecretHash);
      const recovered = recoverAuthorizeParams(dto.next, app.publicId);

      let loginUris: { uri: string; kind: string }[] | null = null;
      if (recovered || isConfidential) {
        loginUris = await prisma.saAppRedirectUri.findMany({
          where: { appId: app.id, kind: 'login' },
          orderBy: { id: 'asc' },
        });
      }

      let recoveredIsValid = false;
      if (recovered && loginUris) {
        try {
          assertRedirectUriAllowed(recovered.redirectUri, { url: app.url, redirectUris: loginUris });
          recoveredIsValid = true;
        } catch {
          recoveredIsValid = false;
        }
      }

      let redirectUri: string | null = null;
      let codeChallenge: string | null = null;
      let codeChallengeMethod: 'S256' | null = null;
      let state: string | null = null;
      let nonce: string | null = null;

      if (recoveredIsValid && recovered) {
        redirectUri = recovered.redirectUri;
        state = recovered.state;
        nonce = recovered.nonce;
        if (recovered.codeChallenge && recovered.codeChallengeMethod === 'S256') {
          codeChallenge = recovered.codeChallenge;
          codeChallengeMethod = 'S256';
        }
      } else if (isConfidential && loginUris && loginUris.length > 0) {
        // When an app has multiple registered login redirect URIs and no
        // usable `next` named one of them, there's no per-request way to
        // indicate which one signup should target — pick the
        // oldest-registered one deterministically.
        redirectUri = loginUris[0].uri;
      }

      let redirectUrl: string | undefined;
      // A public client's code must carry a PKCE challenge to be
      // redeemable; a confidential client's client secret substitutes for
      // one.
      if (redirectUri && (codeChallenge || isConfidential)) {
        const code = await this.oauthService.generateCode(
          saUserPublicId,
          app.publicId,
          redirectUri,
          codeChallenge,
          codeChallengeMethod,
          ['signup'],
          nonce,
          'openid profile email',
          new Date(),
        );
        const url = new URL(redirectUri);
        url.searchParams.set('code', code);
        if (state) url.searchParams.set('state', state);
        redirectUrl = url.toString();
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

  async startRegistration(dto: StartRegistrationDto): Promise<{ ok: true }> {
    const captchaOk = await this.turnstile.verify(dto.turnstileToken);
    if (!captchaOk) {
      throw new UnprocessableEntityException('captcha verification failed');
    }

    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appPublicId } });
    if (!app) throw new NotFoundException('App not found');

    // Reuse an abandoned step-1 signup (placeholder account, never
    // verified, no SaUser yet) instead of erroring, so retrying a dropped
    // signup just works. Anything else with this email — a verified
    // account, or an unverified one that already has a SaUser (shouldn't
    // happen, but fail closed) — is a real duplicate.
    //
    // Confirmed this is the ONLY flow that can leave a User row in that
    // exact shape (emailVerified: false, no linked SaUser), so reuse here
    // can't adopt a dangling account from somewhere else: every social
    // provider and the emailOTP plugin set disableSignUp: true (auth.config.ts)
    // so they never create a User row for an unrecognized email; the
    // magicLink plugin does create one on sign-up, but always with
    // emailVerified: true from the start (better-auth's magic-link/index.mjs);
    // invitation acceptance (invitations.service.ts) only ever updates a
    // User row that users.service.ts's createUser already created alongside
    // its SaUser in the same transaction; and register()'s own failure path
    // deletes the BetterAuth user it just created rather than leaving it
    // behind unverified.
    const existing = await prisma.user.findUnique({
      where: { email: dto.email },
      include: { saUser: true },
    });
    let baUserId: string;
    if (existing) {
      if (existing.emailVerified || existing.saUser) {
        throw new ConflictException('email already registered');
      }
      baUserId = existing.id;
    } else {
      // Never shown or emailed — overwritten with the real password in
      // completeRegistration via BetterAuth's resetPassword token flow.
      const placeholderPassword = randomBytes(24).toString('base64url');
      let signUp: { user: { id: string } };
      try {
        signUp = await auth.api.signUpEmail({
          // `name` is a placeholder too — the real first/last name is
          // collected and written in completeRegistration (Task 6).
          body: { email: dto.email, password: placeholderPassword, name: '' },
        });
      } catch (e: unknown) {
        if (isDuplicateEmailError(e)) {
          throw new ConflictException('email already registered');
        }
        throw e;
      }
      // Same synthetic-user guard as register() — see its comment on
      // emailAndPassword.autoSignIn above.
      const persisted = await prisma.user.findUnique({ where: { id: signUp.user.id }, select: { id: true } });
      if (!persisted) {
        throw new ConflictException('email already registered');
      }
      baUserId = persisted.id;
      // Unlike register()'s catch block, there is no compensating delete of
      // this freshly-created BetterAuth user if sendVerificationCode below
      // throws. None is needed: the "reuse an abandoned step-1 signup"
      // branch at the top of this method IS the recovery path for exactly
      // that failure. A retry of startRegistration for the same email will
      // find this still-unverified, SaUser-less account and reuse it rather
      // than erroring, instead of needing a delete-and-start-over.
    }

    const branding = (app.activationEmailOverride ?? undefined) as ActivationEmailBranding | undefined;
    await sendVerificationCode(
      { createOtp: (d) => auth.api.createVerificationOTP({ body: d }), emailer: getEmailer() },
      { email: dto.email, firstName: 'there', appName: app.name, branding },
    );

    return { ok: true };
  }

  /**
   * BetterAuth's OTP-check/verify endpoints throw an object whose `.body.code`
   * names the failure (confirmed against the installed better-auth@1.6.11's
   * email-otp/routes.mjs and better-call's error.mjs: APIError instances
   * carry `.status`/`.body`). USER_NOT_FOUND collapses into INVALID_OTP —
   * routes.mjs's own comment on that check says it's "safe to leak the
   * existence of a user, given the user has already the OTP from the email",
   * but there's no reason to expose the distinction to this flow's caller
   * either.
   */
  private mapOtpError(e: unknown): BadRequestException | ForbiddenException {
    const code = (e as { body?: { code?: string } })?.body?.code;
    if (code === 'OTP_EXPIRED') return new BadRequestException({ code: 'OTP_EXPIRED' });
    if (code === 'TOO_MANY_ATTEMPTS') return new ForbiddenException({ code: 'TOO_MANY_ATTEMPTS' });
    return new BadRequestException({ code: 'INVALID_OTP' });
  }

  async verifyRegistrationCode(dto: VerifyRegistrationCodeDto): Promise<{ ok: true }> {
    try {
      await auth.api.checkVerificationOTP({
        body: { email: dto.email, type: 'email-verification', otp: dto.otp },
      });
    } catch (e: unknown) {
      throw this.mapOtpError(e);
    }
    return { ok: true };
  }

  async completeRegistration(
    dto: CompleteRegistrationDto,
    ip: string = 'unknown',
  ): Promise<{ ok: true; orgPublicId: string; redirectUrl?: string }> {
    const app = await prisma.saApp.findUnique({ where: { publicId: dto.appPublicId } });
    if (!app) throw new NotFoundException('App not found');

    // Enforce the password policy before ever consuming the OTP — a
    // rejected password must not burn the user's one-shot code.
    validatePasswordOrThrow(dto.password, resolvePasswordPolicy(app));

    const country = resolveCountryFromIp(ip);
    const requiredConsent = resolveRequiredConsent(app, country);
    for (const doc of requiredConsent) {
      const field = doc.documentType === 'privacy_policy' ? 'privacyPolicy'
        : doc.documentType === 'terms' ? 'terms'
        : 'gdpr';
      const accepted = doc.documentType === 'privacy_policy' ? dto.acceptedPrivacyPolicy
        : doc.documentType === 'terms' ? dto.acceptedTerms
        : dto.acceptedGdpr;
      if (accepted !== true) {
        throw new BadRequestException(`You must accept the ${field} before signing up`);
      }
    }

    let defaultOrg: { id: number; publicId: string } | null = null;
    if (app.defaultOrgId) {
      defaultOrg = await prisma.saOrg.findUnique({
        where: { id: app.defaultOrgId },
        select: { id: true, publicId: true },
      });
      if (!defaultOrg) throw new NotFoundException('Default org not found');
    } else if (!dto.companyName?.trim()) {
      throw new BadRequestException('companyName is required');
    }

    // Consume the code for real and flip emailVerified — this is also the
    // guard against completing without ever having gone through steps 1-2
    // for this email (a stale/guessed otp fails here even if it happened to
    // pass the non-consuming checkVerificationOTP check earlier).
    let baUserId: string;
    try {
      const result = await auth.api.verifyEmailOTP({ body: { email: dto.email, otp: dto.otp } });
      baUserId = result.user.id;
    } catch (e: unknown) {
      throw this.mapOtpError(e);
    }

    // The account was created in startRegistration with name: '' — fill in
    // the real name now that it's known.
    await prisma.user.update({ where: { id: baUserId }, data: { name: `${dto.firstName} ${dto.lastName}`.trim() } });

    // Replace the placeholder password from startRegistration with the real
    // one, via BetterAuth's own session-less resetPassword token flow
    // (confirmed against password.mjs: it looks up a Verification row keyed
    // `reset-password:<token>` with `value` = the BetterAuth user id — same
    // format resolve-app-for-reset-token.ts already reads elsewhere in this
    // codebase — then hashes and stores the new password with no session
    // required). The token is minted and redeemed in the same request, so a
    // short expiry is enough.
    const resetToken = randomBytes(24).toString('base64url');
    await prisma.verification.create({
      data: {
        id: randomUUID(),
        identifier: `reset-password:${resetToken}`,
        value: baUserId,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    await auth.api.resetPassword({ body: { newPassword: dto.password, token: resetToken } });

    return this.finishRegistration({
      app,
      baUserId,
      dto: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        companyName: dto.companyName,
        next: dto.next,
        marketingOptIn: dto.marketingOptIn ?? false,
      },
      defaultOrg,
      requiredConsent,
      saUserStatus: 'active',
      sendLinkVerificationEmail: false,
      email: dto.email,
    });
  }

  async getAppName(
    appPublicId: string,
    ip: string = 'unknown',
  ): Promise<{
    name: string;
    hasDefaultOrg: boolean;
    passwordPolicy: PasswordPolicy;
    logo: string | null;
    favicon: string | null;
    privacyPolicyUrl: string | null;
    termsUrl: string | null;
    gdprUrl: string | null;
    gdprRequired: boolean;
    emailVerificationMethod: 'link' | 'code';
    pageLightBackgroundColor: string | null;
    pageDarkBackgroundColor: string | null;
    cardLightBackgroundColor: string | null;
    cardDarkBackgroundColor: string | null;
  }> {
    if (!appPublicId) throw new NotFoundException('App not found');
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: {
        name: true,
        defaultOrgId: true,
        passwordPolicyOverride: true,
        logo: true,
        favicon: true,
        privacyPolicyUrl: true,
        termsUrl: true,
        gdprUrl: true,
        emailVerificationMethod: true,
        pageLightBackgroundColor: true,
        pageDarkBackgroundColor: true,
        cardLightBackgroundColor: true,
        cardDarkBackgroundColor: true,
      },
    });
    if (!app) throw new NotFoundException('App not found');
    const country = resolveCountryFromIp(ip);
    return {
      name: app.name,
      hasDefaultOrg: app.defaultOrgId !== null,
      passwordPolicy: resolvePasswordPolicy(app),
      logo: app.logo ?? null,
      favicon: app.favicon ?? null,
      privacyPolicyUrl: app.privacyPolicyUrl ?? null,
      termsUrl: app.termsUrl ?? null,
      gdprUrl: app.gdprUrl ?? null,
      // Advisory only — the POST /api/register call re-resolves this
      // itself against its own request's IP (see register() above). Reuses
      // resolveRequiredConsent rather than hand-rolling the same rule a
      // second time, so the two expressions of "is GDPR required" can't
      // drift out of sync.
      gdprRequired: resolveRequiredConsent(app, country).some((d) => d.documentType === 'gdpr'),
      // Defaults to 'link' for the same reason formatApp (apps.service.ts)
      // does — a real Prisma row always has this NOT NULL column populated,
      // but hand-built test fixtures and any other caller that doesn't
      // select it should still get the safe, existing-behavior default.
      emailVerificationMethod: (app.emailVerificationMethod ?? 'link') as 'link' | 'code',
      pageLightBackgroundColor: app.pageLightBackgroundColor ?? null,
      pageDarkBackgroundColor: app.pageDarkBackgroundColor ?? null,
      cardLightBackgroundColor: app.cardLightBackgroundColor ?? null,
      cardDarkBackgroundColor: app.cardDarkBackgroundColor ?? null,
    };
  }
}
