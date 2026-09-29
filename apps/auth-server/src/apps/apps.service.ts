import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { prisma, Prisma } from '@sassy-auth/db';
// Same primitive as password hashing (see token/client-auth.ts) — one KDF
// in the codebase, not two.
import { hashPassword } from 'better-auth/crypto';
import { PasswordPolicy, ActivationEmailBranding } from '@sassy-auth/types';
import { SqidService } from '../common/sqid/sqid.service';
import { LoggerService } from '../common/logger/logger.service';
import { checkPermission } from '../common/permissions/check-permission';
import { generatePendingPublicId } from '../common/pending-public-id';
import { resolvePasswordPolicy } from '../auth/password-policy';
import { CreateAppDto } from './dto/create-app.dto';
import { UpdateAppDto } from './dto/update-app.dto';
import { ListAppsQueryDto } from './dto/list-apps-query.dto';

type RedirectUriRow = { uri: string; kind: string };
type AppRow = {
  publicId: string; name: string; url: string; logo?: string | null; favicon?: string | null; isPlatform: boolean;
  twoFactorTrustDays: number | null; twoFactorPromptEnabled: boolean | null; requireTwoFactor: boolean;
  allowOfflineAccess: boolean;
  redirectUris?: RedirectUriRow[];
  // Optional in this type because existing tests build rows by hand without
  // it; a real Prisma row always carries it (no `select` is used on these
  // queries, so every scalar column comes back).
  clientSecretHash?: string | null;
  clientSecretUpdatedAt?: Date | null;
  defaultOrg?: { publicId: string } | null;
  defaultRole?: { publicId: string } | null;
  passwordPolicyOverride?: unknown;
  activationWebhookUrl?: string | null;
  activationWebhookSecret?: string | null;
  activationEmailOverride?: unknown;
  privacyPolicyUrl?: string | null;
  termsUrl?: string | null;
  gdprUrl?: string | null;
};
function formatApp(a: AppRow) {
  return {
    publicId: a.publicId, name: a.name, url: a.url, logo: a.logo ?? null, favicon: a.favicon ?? null, isPlatform: a.isPlatform,
    twoFactorTrustDays: a.twoFactorTrustDays ?? null,
    twoFactorPromptEnabled: a.twoFactorPromptEnabled ?? null,
    requireTwoFactor: a.requireTwoFactor,
    allowOfflineAccess: a.allowOfflineAccess,
    redirectUris: (a.redirectUris ?? []).map((r) => ({ uri: r.uri, kind: r.kind })),
    // The client secret hash itself is never sent to the admin console —
    // only whether one exists (client type is derived, not stored) and when
    // it was last rotated.
    isConfidential: Boolean(a.clientSecretHash),
    clientSecretUpdatedAt: a.clientSecretUpdatedAt ? a.clientSecretUpdatedAt.toISOString() : null,
    defaultOrgId: a.defaultOrg?.publicId ?? null,
    defaultRoleId: a.defaultRole?.publicId ?? null,
    passwordPolicyOverride: (a.passwordPolicyOverride ?? null) as PasswordPolicy | null,
    effectivePasswordPolicy: resolvePasswordPolicy({ passwordPolicyOverride: a.passwordPolicyOverride ?? null }),
    activationWebhookUrl: a.activationWebhookUrl ?? null,
    hasActivationWebhookSecret: Boolean(a.activationWebhookSecret),
    activationEmailOverride: (a.activationEmailOverride ?? null) as ActivationEmailBranding | null,
    privacyPolicyUrl: a.privacyPolicyUrl ?? null,
    termsUrl: a.termsUrl ?? null,
    gdprUrl: a.gdprUrl ?? null,
  };
}

/** Redirect URIs must be absolute http(s) URLs — no javascript:, data:, or relative paths. */
function assertValidRedirectUris(uris: Array<{ uri: string; kind: string }>): void {
  const seen = new Set<string>();
  for (const r of uris) {
    let parsed: URL;
    try {
      parsed = new URL(r.uri);
    } catch {
      throw new BadRequestException(`Invalid redirect URI: ${r.uri}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(`Redirect URI must be http(s): ${r.uri}`);
    }
    if (r.kind !== 'login' && r.kind !== 'post_logout') {
      throw new BadRequestException(`Invalid redirect URI kind: ${r.kind}`);
    }
    // Mirrors the @@unique([appId, uri, kind]) constraint on SaAppRedirectUri.
    // Catching this here, before any DB write, keeps the P2002 handler below
    // unambiguous (it only ever means "app name already exists") and avoids
    // depending on DB-level rollback for this specific cause.
    const key = `${r.uri} ${r.kind}`;
    if (seen.has(key)) {
      throw new BadRequestException(`Duplicate redirect URI: ${r.uri} (${r.kind})`);
    }
    seen.add(key);
  }
}

/** Bounds an app's password policy override to sane values — mirrors
 * assertValidRedirectUris's manual-validation-in-service pattern. */
function assertValidPasswordPolicyOverride(policy: PasswordPolicy): void {
  const numberFields: Array<keyof PasswordPolicy> = ['minLength', 'minNumbers', 'minSpecial'];
  const boolFields: Array<keyof PasswordPolicy> = ['requireUppercase', 'requireLowercase', 'requireNumber', 'requireSpecial'];
  for (const field of numberFields) {
    if (typeof policy[field] !== 'number' || !Number.isFinite(policy[field])) {
      throw new BadRequestException(`passwordPolicyOverride.${field} must be a number`);
    }
  }
  for (const field of boolFields) {
    if (typeof policy[field] !== 'boolean') {
      throw new BadRequestException(`passwordPolicyOverride.${field} must be a boolean`);
    }
  }
  if (policy.minLength < 8 || policy.minLength > 128) {
    throw new BadRequestException('passwordPolicyOverride.minLength must be between 8 and 128');
  }
  if (policy.minNumbers < 0 || policy.minNumbers > policy.minLength) {
    throw new BadRequestException('passwordPolicyOverride.minNumbers must be between 0 and minLength');
  }
  if (policy.minSpecial < 0 || policy.minSpecial > policy.minLength) {
    throw new BadRequestException('passwordPolicyOverride.minSpecial must be between 0 and minLength');
  }
}

const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every field of an activationEmailOverride is optional, but if present must
 * be a string, and fromAddress must look like an email address. fromName,
 * fromAddress and subject are used to construct raw email headers, so a
 * `\r`/`\n` there could inject extra headers — rejected for those three only.
 * message is rendered into the email body (see verify-email.template.ts),
 * not a header, so line breaks are legitimate there — mirrors
 * assertValidPasswordPolicyOverride's manual-validation-in-service pattern. */
function assertValidActivationEmailOverride(override: ActivationEmailBranding): void {
  const fields: Array<keyof ActivationEmailBranding> = ['fromName', 'fromAddress', 'subject', 'message'];
  const headerFields: Array<keyof ActivationEmailBranding> = ['fromName', 'fromAddress', 'subject'];
  for (const field of fields) {
    const value = override[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      throw new BadRequestException(`activationEmailOverride.${field} must be a string`);
    }
    if (headerFields.includes(field) && /[\r\n]/.test(value)) {
      throw new BadRequestException(`activationEmailOverride.${field} must not contain line breaks`);
    }
  }
  if (override.fromAddress !== undefined && !BASIC_EMAIL_PATTERN.test(override.fromAddress)) {
    throw new BadRequestException('activationEmailOverride.fromAddress must be a valid email address');
  }
}

function isPrismaCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === code;
}

/**
 * Resolves a defaultOrgId DTO value (an org publicId, or null to clear) to
 * the numeric id to store, validating the org belongs to this app.
 * `undefined` means "field omitted" and passes through untouched so the
 * caller can distinguish "don't change" from "clear".
 */
async function resolveDefaultOrgId(appId: number, orgPublicId: string | null | undefined): Promise<number | null | undefined> {
  if (orgPublicId === undefined) return undefined;
  if (orgPublicId === null) return null;
  const org = await prisma.saOrg.findUnique({ where: { publicId: orgPublicId }, select: { id: true, appId: true } });
  if (!org) throw new NotFoundException('Default org not found');
  if (org.appId !== appId) throw new BadRequestException('Default org must belong to this app');
  return org.id;
}

/**
 * Resolves a defaultRoleId DTO value (a role publicId, or null to clear) to
 * the numeric id to store, validating the role belongs to this app.
 */
async function resolveDefaultRoleId(appId: number, rolePublicId: string | null | undefined): Promise<number | null | undefined> {
  if (rolePublicId === undefined) return undefined;
  if (rolePublicId === null) return null;
  const role = await prisma.saRole.findUnique({ where: { publicId: rolePublicId }, select: { id: true, appId: true } });
  if (!role) throw new NotFoundException('Default role not found');
  if (role.appId !== appId) throw new BadRequestException('Default role must belong to this app');
  return role.id;
}

@Injectable()
export class AppsService {
  constructor(
    private readonly sqids: SqidService,
    private readonly logger: LoggerService,
  ) {}

  async listApps(callerBaId: string, q: ListAppsQueryDto) {
    // Orgs, permissions and roles are scoped per-app, so those admin pages need
    // to read the apps list to drive their App filter dropdown.
    await checkPermission(callerBaId, [
      'platform.apps.manage',
      'platform.orgs.manage',
      'platform.permissions.manage',
      'platform.roles.manage',
    ]);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const escaped = q.q ? q.q.replace(/%/g, '\\%').replace(/_/g, '\\_') : undefined;
    const where = escaped
      ? { OR: [{ name: { contains: escaped, mode: 'insensitive' as const } }, { url: { contains: escaped, mode: 'insensitive' as const } }] }
      : {};
    const [rows, total] = await Promise.all([
      // Finding 2 (final review): an explicit `select` — deliberately
      // omitting `logo` — rather than the `include` used by getApp /
      // createApp / updateApp. The admin console's apps table never renders
      // logos, so pulling every row's full base64 blob from the DB here (up
      // to ~342KB each, times a 25-row page) was pure waste on both the DB
      // round-trip and the response payload. Unlike this endpoint,
      // getApp/createApp/updateApp keep returning `logo` because the edit
      // drawer's dedicated GET /api/apps/:publicId fetch needs it.
      prisma.saApp.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
        select: {
          publicId: true,
          name: true,
          url: true,
          isPlatform: true,
          twoFactorTrustDays: true,
          twoFactorPromptEnabled: true,
          requireTwoFactor: true,
          allowOfflineAccess: true,
          clientSecretHash: true,
          clientSecretUpdatedAt: true,
          passwordPolicyOverride: true,
          activationWebhookUrl: true,
          activationWebhookSecret: true,
          activationEmailOverride: true,
          privacyPolicyUrl: true,
          termsUrl: true,
          gdprUrl: true,
          redirectUris: true,
          defaultOrg: { select: { publicId: true } },
          defaultRole: { select: { publicId: true } },
        },
      }),
      prisma.saApp.count({ where }),
    ]);
    // Belt-and-suspenders on top of the `select` above: force `logo: null`
    // on every formatted row regardless of what the row object happens to
    // carry, so this endpoint can never leak a logo blob even if a future
    // change to the query (e.g. someone adding `logo: true` back to
    // `select`, or swapping it for `include`) slips past review. `logo`
    // stays nullable/optional on AppRow and the App type, so this reads as
    // "not sent for this view," not a lie about the data.
    return { items: rows.map((r) => ({ ...formatApp(r), logo: null, favicon: null })), total, page, pageSize };
  }

  async getApp(callerBaId: string, publicId: string) {
    // bug-0164: sibling to orgs/roles/permissions/users `get`. Apps are
    // read from the same required-perms surface as `listApps` — the
    // orgs / permissions / roles admin pages need to render the parent
    // app's name when displaying a single record. Apps are not
    // org-scoped so no `targetOrgId` is threaded (contrast with
    // orgs.service.ts::getOrg).
    await checkPermission(callerBaId, [
      'platform.apps.manage',
      'platform.orgs.manage',
      'platform.permissions.manage',
      'platform.roles.manage',
    ]);
    const app = await prisma.saApp.findUnique({ where: { publicId }, include: { redirectUris: true, defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } } });
    if (!app) throw new NotFoundException();
    return formatApp(app);
  }

  async createApp(callerBaId: string, dto: CreateAppDto) {
    await checkPermission(callerBaId, 'platform.apps.manage');
    if (dto.redirectUris) assertValidRedirectUris(dto.redirectUris);
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const created = await prisma.$transaction(async (tx: Tx) => {
        const draft = await tx.saApp.create({
          data: { publicId: generatePendingPublicId(), name: dto.name, url: dto.url, logo: dto.logo ?? null, favicon: dto.favicon ?? null, isPlatform: false, twoFactorTrustDays: dto.twoFactorTrustDays ?? null, twoFactorPromptEnabled: dto.twoFactorPromptEnabled ?? null, requireTwoFactor: dto.requireTwoFactor ?? false, allowOfflineAccess: dto.allowOfflineAccess ?? false },
        });
        const updated = await tx.saApp.update({ where: { id: draft.id }, data: { publicId: this.sqids.encode(draft.id) } });
        if (dto.redirectUris) {
          await tx.saAppRedirectUri.deleteMany({ where: { appId: draft.id } });
          await tx.saAppRedirectUri.createMany({
            data: dto.redirectUris.map((r) => ({ appId: draft.id, uri: r.uri, kind: r.kind })),
          });
        }
        return updated;
      });
      this.logger.getWinstonLogger().info('App created', { context: 'AppsService', appId: created.publicId });
      return formatApp({ ...created, redirectUris: dto.redirectUris ?? [], defaultOrg: null, defaultRole: null });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('App with this name already exists');
      throw e;
    }
  }

  async updateApp(callerBaId: string, publicId: string, dto: UpdateAppDto) {
    if (
      dto.name === undefined &&
      dto.url === undefined &&
      dto.logo === undefined &&
      dto.favicon === undefined &&
      dto.twoFactorTrustDays === undefined &&
      dto.twoFactorPromptEnabled === undefined &&
      dto.requireTwoFactor === undefined &&
      dto.allowOfflineAccess === undefined &&
      dto.redirectUris === undefined &&
      dto.defaultOrgId === undefined &&
      dto.defaultRoleId === undefined &&
      dto.passwordPolicyOverride === undefined &&
      dto.activationWebhookUrl === undefined &&
      dto.privacyPolicyUrl === undefined &&
      dto.termsUrl === undefined &&
      dto.gdprUrl === undefined &&
      dto.activationEmailOverride === undefined
    ) {
      throw new BadRequestException(
        'At least one of name, url, logo, favicon, twoFactorTrustDays, twoFactorPromptEnabled, requireTwoFactor, allowOfflineAccess, redirectUris, defaultOrgId, defaultRoleId, passwordPolicyOverride, activationWebhookUrl, privacyPolicyUrl, termsUrl, gdprUrl, or activationEmailOverride must be provided',
      );
    }
    await checkPermission(callerBaId, 'platform.apps.manage');
    const existing = await prisma.saApp.findUnique({
      where: { publicId },
      include: { redirectUris: true, defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } },
    });
    if (!existing) throw new NotFoundException();
    if (existing.isPlatform) throw new ForbiddenException('Platform app cannot be modified');
    if (dto.redirectUris) assertValidRedirectUris(dto.redirectUris);
    if (dto.passwordPolicyOverride) assertValidPasswordPolicyOverride(dto.passwordPolicyOverride);
    if (dto.activationEmailOverride) assertValidActivationEmailOverride(dto.activationEmailOverride);
    // Validation must happen before any write, so this runs before the
    // transaction starts.
    const resolvedDefaultOrgId = await resolveDefaultOrgId(existing.id, dto.defaultOrgId);
    const resolvedDefaultRoleId = await resolveDefaultRoleId(existing.id, dto.defaultRoleId);
    try {
      type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
      const updated = await prisma.$transaction(async (tx: Tx) => {
        const updatedApp = await tx.saApp.update({
          where: { publicId },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.url !== undefined && { url: dto.url }),
            ...(dto.logo !== undefined && { logo: dto.logo }),
            ...(dto.favicon !== undefined && { favicon: dto.favicon }),
            ...(dto.twoFactorTrustDays !== undefined && {
              twoFactorTrustDays: dto.twoFactorTrustDays,
            }),
            ...(dto.twoFactorPromptEnabled !== undefined && {
              twoFactorPromptEnabled: dto.twoFactorPromptEnabled,
            }),
            ...(dto.requireTwoFactor !== undefined && {
              requireTwoFactor: dto.requireTwoFactor,
            }),
            ...(dto.allowOfflineAccess !== undefined && {
              allowOfflineAccess: dto.allowOfflineAccess,
            }),
            ...(resolvedDefaultOrgId !== undefined && { defaultOrgId: resolvedDefaultOrgId }),
            ...(resolvedDefaultRoleId !== undefined && { defaultRoleId: resolvedDefaultRoleId }),
            ...(dto.passwordPolicyOverride !== undefined && {
              // Prisma's nullable-Json columns distinguish "field omitted"
              // (undefined) from "set to JSON null" (Prisma.JsonNull) — a bare
              // `null` is rejected by the generated input type.
              passwordPolicyOverride: (dto.passwordPolicyOverride === null
                ? Prisma.JsonNull
                : (dto.passwordPolicyOverride as unknown as Prisma.InputJsonValue)),
            }),
            ...(dto.activationWebhookUrl !== undefined && {
              activationWebhookUrl: dto.activationWebhookUrl,
              // Clearing the URL clears the secret with it — a webhook is
              // never left half-configured (see rotateWebhookSecret, the
              // only place a secret is ever set, which requires a URL to
              // already be present).
              ...(dto.activationWebhookUrl === null && { activationWebhookSecret: null }),
            }),
            ...(dto.privacyPolicyUrl !== undefined && { privacyPolicyUrl: dto.privacyPolicyUrl }),
            ...(dto.termsUrl !== undefined && { termsUrl: dto.termsUrl }),
            ...(dto.gdprUrl !== undefined && { gdprUrl: dto.gdprUrl }),
            ...(dto.activationEmailOverride !== undefined && {
              activationEmailOverride: (dto.activationEmailOverride === null
                ? Prisma.JsonNull
                : (dto.activationEmailOverride as unknown as Prisma.InputJsonValue)),
            }),
          },
          include: { defaultOrg: { select: { publicId: true } }, defaultRole: { select: { publicId: true } } },
        });
        if (dto.redirectUris) {
          // deleteMany + createMany must live in the same transaction as the
          // app row update: if createMany fails (e.g. a duplicate {uri, kind}
          // pair that slips past assertValidRedirectUris, such as a race with
          // a concurrent request), the whole transaction rolls back instead
          // of leaving the app with zero registered redirect URIs.
          await tx.saAppRedirectUri.deleteMany({ where: { appId: existing.id } });
          await tx.saAppRedirectUri.createMany({
            data: dto.redirectUris.map((r) => ({ appId: existing.id, uri: r.uri, kind: r.kind })),
          });
        }
        return updatedApp;
      });
      this.logger.getWinstonLogger().info('App updated', { context: 'AppsService', appId: publicId });
      return formatApp({ ...updated, redirectUris: dto.redirectUris ?? existing.redirectUris });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2002')) throw new ConflictException('App with this name already exists');
      throw e;
    }
  }

  /**
   * Generates a new client secret, returning the plaintext exactly once. The
   * stored hash is replaced immediately; there is no dual-secret grace window.
   * Presence of `clientSecretHash` is what makes an app confidential — this
   * is the only place that column is written.
   */
  async rotateClientSecret(callerBaId: string, publicId: string): Promise<{ clientSecret: string }> {
    // Same guard `updateApp` uses — apps are not org-scoped, so any caller
    // with `platform.apps.manage` may rotate any app's secret.
    await checkPermission(callerBaId, 'platform.apps.manage');
    const existing = await prisma.saApp.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();

    const clientSecret = crypto.randomBytes(32).toString('base64url');
    await prisma.saApp.update({
      where: { publicId },
      data: { clientSecretHash: await hashPassword(clientSecret), clientSecretUpdatedAt: new Date() },
    });
    this.logger.getWinstonLogger().info('Client secret rotated', { context: 'AppsService', appId: publicId });
    return { clientSecret };
  }

  /**
   * Generates a new webhook signing secret, returning the plaintext exactly
   * once. Unlike clientSecretHash, this is stored in plaintext (see
   * notify-activation.ts) because it signs OUTGOING requests rather than
   * verifying an incoming credential — the server needs it back to compute
   * the HMAC. This is the only place the value is ever written, replacing
   * the old free-text `webhookSecret` DTO field so an admin can no longer
   * set a low-entropy secret by hand.
   */
  async rotateWebhookSecret(callerBaId: string, publicId: string): Promise<{ activationWebhookSecret: string }> {
    await checkPermission(callerBaId, 'platform.apps.manage');
    const existing = await prisma.saApp.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    if (!existing.activationWebhookUrl) {
      throw new BadRequestException('Set a webhook URL before generating a webhook secret');
    }

    const activationWebhookSecret = crypto.randomBytes(32).toString('base64url');
    await prisma.saApp.update({ where: { publicId }, data: { activationWebhookSecret } });
    this.logger.getWinstonLogger().info('Webhook secret rotated', { context: 'AppsService', appId: publicId });
    return { activationWebhookSecret };
  }

  async deleteApp(callerBaId: string, publicId: string): Promise<void> {
    await checkPermission(callerBaId, 'platform.apps.manage');
    const existing = await prisma.saApp.findUnique({ where: { publicId } });
    if (!existing) throw new NotFoundException();
    if (existing.isPlatform) throw new ForbiddenException('Platform app cannot be modified');
    try {
      await prisma.saApp.delete({ where: { publicId } });
      this.logger.getWinstonLogger().info('App deleted', { context: 'AppsService', appId: publicId });
    } catch (e: unknown) {
      if (isPrismaCode(e, 'P2003')) {
        throw new ConflictException('App has dependent organizations, roles, or permissions');
      }
      throw e;
    }
  }
}
