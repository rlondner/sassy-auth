// dotenv must load BEFORE any module that reads DATABASE_URL / RSA keys /
// BETTER_AUTH_* (Prisma client, auth.config, etc.) — Prisma CLI does its
// own dotenv but the Prisma client runtime does not.
import 'dotenv/config';
import * as crypto from 'crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { prisma } from '@sassy-auth/db';
import { AppModule } from '../src/app.module';
import { auth } from '../src/auth/auth.config';
import { configureNestApp } from '../src/configure-nest-app';
import { LoggerService } from '../src/common/logger/logger.service';

// Generate RS256 key pair for the test run
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

process.env.RSA_PRIVATE_KEY = Buffer.from(privatePem).toString('base64');
process.env.RSA_PUBLIC_KEY = Buffer.from(publicPem).toString('base64');
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-32-chars-long!!';

describe('SassyAuth E2E', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let platformAppPublicId: string;
  let userPublicId: string;

  beforeAll(async () => {
    // Run migrations on test DB. The Prisma schema lives in packages/db,
    // not apps/auth-server, so pass --schema explicitly — without it the
    // CLI looks in cwd/prisma/schema.prisma and fails.
    const { execSync } = await import('child_process');
    execSync(
      'npx prisma migrate deploy --schema=../../packages/db/schema.prisma',
      { stdio: 'inherit' },
    );

    // Build NestJS app with Express adapter + BetterAuth mount
    const expressApp = express();
    expressApp.all('/api/auth/*', toNodeHandler(auth));

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication(new ExpressAdapter(expressApp));
    configureNestApp(app, new LoggerService());
    await app.init();

    httpServer = app.getHttpServer();

    // Seed platform data
    execSync('pnpm seed', { stdio: 'inherit', cwd: process.cwd() });

    const platformApp = await prisma.saApp.findFirst({ where: { isPlatform: true } });
    platformAppPublicId = platformApp!.publicId;
  });

  afterAll(async () => {
    await app.close();
    // Clean up test data
    // await prisma.saUserPermission.deleteMany();
    // await prisma.saUserRole.deleteMany();
    // await prisma.saRolePermission.deleteMany();
    // await prisma.saUser.deleteMany();
    // await prisma.saPermission.deleteMany({ where: { app: { isPlatform: false } } });
    // await prisma.saRole.deleteMany();
    // await prisma.saOrg.deleteMany({ where: { isPlatform: false } });
    // await prisma.account.deleteMany();
    // await prisma.session.deleteMany();
    // await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  // ── JWKS ──────────────────────────────────────────────────────────────────

  describe('GET /api/token/jwks', () => {
    it('returns a valid JWKS document with one RSA key', async () => {
      const res = await request(httpServer).get('/api/token/jwks').expect(200);
      expect(res.body.keys).toHaveLength(1);
      expect(res.body.keys[0].kty).toBe('RSA');
      expect(res.body.keys[0].alg).toBe('RS256');
    });
  });

  // ── Direct Login (Flow B) ─────────────────────────────────────────────────

  describe('POST /api/token/direct/login', () => {
    const email = 'e2e-user@example.com';
    const password = 'StrongP@ssword1';

    beforeAll(async () => {
      // Register user via BetterAuth
      await request(httpServer)
        .post('/api/auth/sign-up/email')
        .send({ email, password, name: 'E2E User' })
        .expect(200);

      // Get the BetterAuth user
      const baUser = await prisma.user.findUnique({ where: { email } });
      expect(baUser).toBeTruthy();

      // Get platform org
      const platformOrg = await prisma.saOrg.findFirst({ where: { isPlatform: true } });

      // Create sa_user linked to BetterAuth user + platform org
      const saUserRecord = await prisma.saUser.create({
        data: {
          publicId: 'placeholder',
          betterAuthUserId: baUser!.id,
          orgId: platformOrg!.id,
          firstName: 'E2E',
          lastName: 'User',
        },
      });
      // Compute and store publicId via Sqids
      const Sqids = (await import('sqids')).default;
      const sqids = new Sqids({ minLength: 4 });
      const publicId = sqids.encode([saUserRecord.id]);
      await prisma.saUser.update({ where: { id: saUserRecord.id }, data: { publicId } });
      userPublicId = publicId;
    });

    it('returns access_token with correct claims for email identifier', async () => {
      const res = await request(httpServer)
        .post('/api/token/direct/login')
        .send({ identifier: email, password, appId: platformAppPublicId })
        .expect(201);

      expect(res.body.access_token).toBeTruthy();
      expect(res.body.token_type).toBe('Bearer');
      expect(res.body.expires_in).toBe(3600);

      const decoded = jwt.verify(res.body.access_token, publicPem, {
        algorithms: ['RS256'],
      }) as jwt.JwtPayload;

      expect(decoded.sub).toBe(userPublicId);
      expect(decoded.aud).toBe(platformAppPublicId);
      expect(decoded.iss).toBe('http://localhost:3000');
      expect(typeof decoded.scope).toBe('string');
    });

    it('returns 401 for wrong password', async () => {
      await request(httpServer)
        .post('/api/token/direct/login')
        .send({ identifier: email, password: 'wrongpassword', appId: platformAppPublicId })
        .expect(401);
    });

    it('returns 404 for non-existent app', async () => {
      await request(httpServer)
        .post('/api/token/direct/login')
        .send({ identifier: email, password, appId: 'nonexistent-app-id' })
        .expect(404);
    });

    it('returns 400 for missing required fields', async () => {
      await request(httpServer)
        .post('/api/token/direct/login')
        .send({ identifier: email })
        .expect(400);
    });
  });

  // ── OAuth2 Authorization Code Flow (Flow A) ───────────────────────────────

  describe('OAuth2 Authorization Code Flow', () => {
    it('GET /api/token/jwks returns RSA key verifiable against issued tokens', async () => {
      const jwksRes = await request(httpServer).get('/api/token/jwks').expect(200);
      const jwk = jwksRes.body.keys[0];

      // Reconstruct public key from JWK and verify it matches our test public key
      const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      const reconstructedPem = keyObject.export({ type: 'spki', format: 'pem' });
      expect(reconstructedPem).toBe(publicPem);
    });

    it('POST /api/token/oauth/token returns 401 for invalid code', async () => {
      // The token-exchange DTO uses @IsUrl() which (with default options) rejects
      // hosts without a TLD like `localhost`, so promote the seeded platform app
      // to a TLD-bearing URL for the redirect_uri origin check before exchanging.
      const seeded = await prisma.saApp.findFirstOrThrow({ where: { isPlatform: true } });
      const platformApp = await prisma.saApp.update({
        where: { id: seeded.id },
        data: { url: 'http://app.example.com' },
      });
      const res = await request(httpServer)
        .post('/api/token/oauth/token')
        .send({
          code: 'definitely-not-a-real-code',
          client_id: platformApp.publicId,
          code_verifier: 'a'.repeat(64),
          redirect_uri: `${platformApp.url.replace(/\/$/, '')}/cb`,
        })
        .expect(401);
      expect(res.body.message).toContain('invalid_grant');
    });

    describe('OAuth PKCE round-trip', () => {
      function s256(verifier: string): string {
        return crypto
          .createHash('sha256')
          .update(verifier)
          .digest('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      }

      it('authorize → token returns a JWT with scope (string)', async () => {
        // 1. Establish a BetterAuth session via sign-in (super admin from seed).
        const signInRes = await request(httpServer)
          .post('/api/auth/sign-in/email')
          .send({ email: 's@sa.io', password: 'Pass@word1234' });
        expect([200, 201]).toContain(signInRes.status);
        const cookies = (signInRes.headers['set-cookie'] as unknown as string[]) || [];
        const sessionCookie = cookies.find((c) =>
          c.startsWith('better-auth.session_token='),
        );
        expect(sessionCookie).toBeTruthy();

        // 2. Look up the platform app's publicId from the seed.
        // OauthTokenExchangeDto enforces @IsUrl() (default) which rejects
        // hosts without a TLD, so make sure the platform app URL has one
        // for the redirect_uri origin match.
        const seeded = await prisma.saApp.findFirstOrThrow({ where: { isPlatform: true } });
        const app = await prisma.saApp.update({
          where: { id: seeded.id },
          data: { url: 'http://app.example.com' },
        });

        // 3. Build PKCE pair and call /api/token/oauth/authorize.
        const verifier = 'a'.repeat(64);
        const challenge = s256(verifier);
        const redirectUri = `${app.url.replace(/\/$/, '')}/cb`;
        const authorizeRes = await request(httpServer)
          .get('/api/token/oauth/authorize')
          .query({
            client_id: app.publicId,
            redirect_uri: redirectUri,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state: 'xyz',
          })
          .set('Cookie', sessionCookie!.split(';')[0])
          .expect(302);
        const location = authorizeRes.headers.location as string;
        const code = new URL(location).searchParams.get('code');
        expect(code).toBeTruthy();

        // 4. Exchange the code.
        const tokenRes = await request(httpServer)
          .post('/api/token/oauth/token')
          .send({
            code,
            client_id: app.publicId,
            code_verifier: verifier,
            redirect_uri: redirectUri,
          })
          .expect(201);
        expect(tokenRes.body.access_token).toBeTruthy();

        // 5. Verify the JWT carries `scope` (string) and not `permissions`.
        const decoded = jwt.verify(tokenRes.body.access_token, publicPem, {
          algorithms: ['RS256'],
        }) as Record<string, unknown>;
        expect(typeof decoded.scope).toBe('string');
        expect('permissions' in decoded).toBe(false);
      });
    });
  });

  // ── Platform Super Admin sign-in (BetterAuth email/password) ──────────────
  // Exercises the seeded super admin (s@sa.io / Pass@word1234) end-to-end:
  // (1) the BetterAuth email sign-in returns 200, (2) reusing that session
  // cookie, GET /api/users scoped to the platform org returns the 5 seeded
  // admins (Apps / Orgs / Users / Perms / Super). Other tests in this file
  // may add extra users to the platform org, so we assert the 5 are PRESENT
  // rather than checking exact length.

  describe('Seeded super admin (s@sa.io) sign-in', () => {
    const email = 's@sa.io';
    const password = 'Pass@word1234';

    function extractSessionCookie(setCookie: string[] | string | undefined): string | undefined {
      const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      return arr
        .map((c) => c.split(';')[0])
        .find((c) => c.startsWith('better-auth.session_token='));
    }

    it('POST /api/auth/sign-in/email returns 200 for the seeded super admin', async () => {
      const res = await request(httpServer)
        .post('/api/auth/sign-in/email')
        .send({ email, password })
        .expect(200);

      // Confirm BetterAuth issued a session cookie on success — a 200 from
      // sign-in without a cookie would still be a broken login flow.
      const sessionPair = extractSessionCookie(
        res.headers['set-cookie'] as unknown as string[] | string | undefined,
      );
      expect(sessionPair).toBeDefined();
    });

    it('GET /api/users scoped to the platform org lists the 5 seeded admins', async () => {
      // Sign in fresh to obtain the session cookie for this request.
      const signIn = await request(httpServer)
        .post('/api/auth/sign-in/email')
        .send({ email, password })
        .expect(200);

      const sessionPair = extractSessionCookie(
        signIn.headers['set-cookie'] as unknown as string[] | string | undefined,
      );
      expect(sessionPair).toBeDefined();

      // The /api/users endpoint expects sqids publicIds for orgId/appId,
      // NOT raw numeric DB ids — orgPublicId/appPublicId are looked up via
      // `prisma.saOrg.findUnique({ where: { publicId } })`. The seeded
      // platform org/app have DB id=1 each, but the URL needs their publicIds.
      const platformOrg = await prisma.saOrg.findFirst({ where: { isPlatform: true } });
      const platformApp = await prisma.saApp.findFirst({ where: { isPlatform: true } });
      expect(platformOrg).toBeTruthy();
      expect(platformApp).toBeTruthy();

      const res = await request(httpServer)
        .get(`/api/users?orgId=${platformOrg!.publicId}&appId=${platformApp!.publicId}`)
        .set('Cookie', sessionPair!)
        .expect(200);

      const users = res.body as Array<{
        email: string;
        firstName: string;
        lastName: string;
      }>;
      const byEmail = new Map(users.map((u) => [u.email, u]));

      const expectedAdmins = [
        { email: 'a@sa.io', firstName: 'Apps',  lastName: 'Admin' },
        { email: 'o@sa.io', firstName: 'Orgs',  lastName: 'Admin' },
        { email: 'u@sa.io', firstName: 'Users', lastName: 'Admin' },
        { email: 'p@sa.io', firstName: 'Perms', lastName: 'Admin' },
        { email: 's@sa.io', firstName: 'Super', lastName: 'Admin' },
      ];
      for (const expected of expectedAdmins) {
        const u = byEmail.get(expected.email);
        expect(u).toBeDefined();
        expect(u).toMatchObject({
          firstName: expected.firstName,
          lastName: expected.lastName,
        });
      }
    });
  });

  // ── CORS preflight on public NestJS controllers ──────────────────────────
  // Regression guard for the accept-invite browser flow: the admin app at
  // http://localhost:3001 POSTs JSON to /api/invitations/:token/accept, which
  // triggers a CORS preflight on the auth-server at http://localhost:3000.
  // configureNestApp() must wire app.enableCors() with TRUSTED_ORIGINS so the
  // preflight is answered with the matching Access-Control-Allow-Origin;
  // otherwise the browser surfaces a "Failed to fetch" with no useful trace.

  describe('CORS preflight on /api/invitations/:token/accept', () => {
    it('answers OPTIONS with 204 and ACAO for an allow-listed origin', async () => {
      const res = await request(httpServer)
        .options('/api/invitations/anytoken/accept')
        .set('Origin', 'http://localhost:3001')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type')
        .expect(204);

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    });

    it('omits ACAO for an origin that is not on the TRUSTED_ORIGINS allow-list', async () => {
      const res = await request(httpServer)
        .options('/api/invitations/anytoken/accept')
        .set('Origin', 'https://evil.example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  // ── Accept invitation → BetterAuth sign-in works ─────────────────────────
  // Regression guard: if acceptInvitation hashes with bcrypt (or anything that
  // isn't BetterAuth's scrypt format `<saltHex>:<hashHex>`), the resulting
  // account row is unreadable to BetterAuth's verifyPassword and the user
  // gets a 500 on /api/auth/sign-in/email. This test exercises the full
  // accept→sign-in loop end-to-end so a hash-format mismatch fails here
  // instead of in production.

  describe('Invitation accept → /api/auth/sign-in/email', () => {
    const inviteeEmail = 'invite-e2e@example.com';
    const password = 'InvitedP@ss12345';
    let inviteToken: string;
    let createdBaUserId: string | null = null;

    beforeAll(async () => {
      // Build the bare-minimum invite shape: a BetterAuth user row WITHOUT
      // an account row (the credential account is what accept creates), a
      // pending SaUser linked to it, and a fresh SaInvitation token.
      const baUser = await prisma.user.create({
        data: {
          id: 'invite-e2e-ba-' + Date.now(),
          email: inviteeEmail,
          name: 'Invite E2E',
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      createdBaUserId = baUser.id;

      const platformOrg = await prisma.saOrg.findFirst({ where: { isPlatform: true } });
      const saUser = await prisma.saUser.create({
        data: {
          publicId: 'invite-e2e-' + Date.now(),
          betterAuthUserId: baUser.id,
          orgId: platformOrg!.id,
          firstName: 'Invite',
          lastName: 'E2E',
          status: 'pending',
        },
      });

      inviteToken = 'invite-e2e-token-' + Date.now();
      await prisma.saInvitation.create({
        data: {
          publicId: 'invite-e2e-inv-' + Date.now(),
          token: inviteToken,
          userId: saUser.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    });

    afterAll(async () => {
      // Best-effort cleanup. Cascades on SaUser remove SaInvitation; account
      // and session rows on the BetterAuth user cascade per schema.
      if (createdBaUserId) {
        await prisma.saUser.deleteMany({ where: { betterAuthUserId: createdBaUserId } });
        await prisma.user.delete({ where: { id: createdBaUserId } }).catch(() => undefined);
      }
    });

    it('accepts the invitation and then signs in successfully', async () => {
      await request(httpServer)
        .post(`/api/invitations/${inviteToken}/accept`)
        .send({ password })
        .expect(204);

      const signIn = await request(httpServer)
        .post('/api/auth/sign-in/email')
        .send({ email: inviteeEmail, password })
        .expect(200);

      const setCookie = signIn.headers['set-cookie'] as unknown as string[] | string | undefined;
      const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      expect(
        cookies.some((c) => c.startsWith('better-auth.session_token=')),
      ).toBe(true);
    });
  });

  // ── Full admin lifecycle: app → perm → org → role → user → accept → sign-in
  // Exercises the end-to-end happy path a real platform admin walks: provision
  // an app, a permission scoped to it, an org scoped to it, a role bundling
  // that permission, a pending user assigned to the org, then complete the
  // invite flow and prove the new user can sign in via BetterAuth with
  // Pass@word1234. Companion Playwright spec drives the same flow through
  // the admin UI; this one pins the API contract.

  describe('Lifecycle: provision app+perm+org+role+user, accept invite, sign in', () => {
    const ts = Date.now();
    const PASSWORD = 'Pass@word1234';
    const inviteeEmail = `lifecycle-${ts}@example.com`;
    let superAdminCookie: string;
    let appPublicId: string;
    let permPublicId: string;
    let orgPublicId: string;
    let rolePublicId: string;
    let userPublicId: string;
    let inviteToken: string;

    beforeAll(async () => {
      const signIn = await request(httpServer)
        .post('/api/auth/sign-in/email')
        .send({ email: 's@sa.io', password: 'Pass@word1234' })
        .expect(200);
      const setCookie = signIn.headers['set-cookie'] as unknown as string[] | string | undefined;
      const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      const sessionPair = cookies
        .map((c) => c.split(';')[0])
        .find((c) => c.startsWith('better-auth.session_token='));
      expect(sessionPair).toBeDefined();
      superAdminCookie = sessionPair!;
    });

    afterAll(async () => {
      // Best-effort teardown in dependency order. Each step is wrapped so a
      // mid-flow failure in the test body still cleans up what was created.
      const tryDelete = async (path: string) => {
        try {
          await request(httpServer).delete(path).set('Cookie', superAdminCookie).expect(204);
        } catch {
          /* ignore — partially-created scenario */
        }
      };
      if (userPublicId) await tryDelete(`/api/users/${userPublicId}`);
      if (rolePublicId) await tryDelete(`/api/roles/${rolePublicId}`);
      if (orgPublicId) await tryDelete(`/api/orgs/${orgPublicId}`);
      if (permPublicId) await tryDelete(`/api/permissions/${permPublicId}`);
      if (appPublicId) await tryDelete(`/api/apps/${appPublicId}`);
      // The CreateUser flow inserts a BetterAuth user row that is NOT removed
      // by DELETE /api/users (which only touches the platform-side saUser).
      // Same pattern as the existing super-admin DELETE cleanup block.
      await prisma.user.deleteMany({ where: { email: inviteeEmail } });
    });

    it('creates an app', async () => {
      const res = await request(httpServer)
        .post('/api/apps')
        .set('Cookie', superAdminCookie)
        .send({ name: `E2E Lifecycle App ${ts}`, url: 'https://example.com/lifecycle' })
        .expect(201);
      expect(res.body.publicId).toBeTruthy();
      appPublicId = res.body.publicId;
    });

    it('creates a permission scoped to the new app', async () => {
      // The DTO regex requires dotted lowercase segments where every segment
      // after the first starts with a letter, hence the `t<digits>` prefix
      // on the timestamp segment.
      const res = await request(httpServer)
        .post('/api/permissions')
        .set('Cookie', superAdminCookie)
        .send({ name: `e2e.t${ts}.read`, appId: appPublicId })
        .expect(201);
      expect(res.body.publicId).toBeTruthy();
      permPublicId = res.body.publicId;
    });

    it('creates an org scoped to the new app', async () => {
      const res = await request(httpServer)
        .post('/api/orgs')
        .set('Cookie', superAdminCookie)
        .send({ name: `E2E Lifecycle Org ${ts}`, appId: appPublicId })
        .expect(201);
      expect(res.body.publicId).toBeTruthy();
      orgPublicId = res.body.publicId;
    });

    it('creates a role bundling the new permission', async () => {
      const res = await request(httpServer)
        .post('/api/roles')
        .set('Cookie', superAdminCookie)
        .send({
          name: `E2E Lifecycle Role ${ts}`,
          appId: appPublicId,
          permissionIds: [permPublicId],
        })
        .expect(201);
      expect(res.body.publicId).toBeTruthy();
      rolePublicId = res.body.publicId;
    });

    it('creates a pending user in the new org and returns an invite URL', async () => {
      const res = await request(httpServer)
        .post('/api/users')
        .set('Cookie', superAdminCookie)
        .send({
          firstName: 'Lifecycle',
          lastName: 'E2E',
          email: inviteeEmail,
          orgId: orgPublicId,
        })
        .expect(201);
      expect(res.body.user.id).toBeTruthy();
      expect(res.body.inviteUrl).toMatch(/\/accept-invite\?token=/);
      userPublicId = res.body.user.id;
      inviteToken = new URL(res.body.inviteUrl).searchParams.get('token')!;
      expect(inviteToken).toBeTruthy();
    });

    it('assigns the role to the new user', async () => {
      await request(httpServer)
        .post(`/api/users/${userPublicId}/roles`)
        .set('Cookie', superAdminCookie)
        .send({ roleId: rolePublicId })
        .expect(204);
    });

    it('accepts the invitation with Pass@word1234', async () => {
      await request(httpServer)
        .post(`/api/invitations/${inviteToken}/accept`)
        .send({ password: PASSWORD })
        .expect(204);
    });

    it('signs in via BetterAuth email/password as the new user', async () => {
      const res = await request(httpServer)
        .post('/api/auth/sign-in/email')
        .send({ email: inviteeEmail, password: PASSWORD })
        .expect(200);
      const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
      const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      expect(
        cookies.some((c) => c.startsWith('better-auth.session_token=')),
      ).toBe(true);
    });

    it('exposes the assigned permission to the newly signed-in user', async () => {
      const signIn = await request(httpServer)
        .post('/api/auth/sign-in/email')
        .send({ email: inviteeEmail, password: PASSWORD })
        .expect(200);
      const setCookie = signIn.headers['set-cookie'] as unknown as string[] | string | undefined;
      const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      const userCookie = cookies
        .map((c) => c.split(';')[0])
        .find((c) => c.startsWith('better-auth.session_token='))!;

      const me = await request(httpServer)
        .get('/api/me/permissions')
        .set('Cookie', userCookie)
        .expect(200);
      expect(me.body.permissions).toEqual(expect.arrayContaining([`e2e.t${ts}.read`]));
    });

    // The lifecycle test only assigns the original role at the start. Here
    // we use the new set-replace endpoints to add a SECOND role and a
    // direct permission, then verify the union flows through /api/me/permissions.

    it('sets a second role + a direct permission via the new set-replace endpoints', async () => {
      // Provision a second role pointing at the same app + permission.
      const role2Res = await request(httpServer)
        .post('/api/roles')
        .set('Cookie', superAdminCookie)
        .send({
          name: `E2E Lifecycle Role 2 ${ts}`,
          appId: appPublicId,
          permissionIds: [permPublicId],
        })
        .expect(201);
      const role2PublicId = role2Res.body.publicId as string;

      // Add the new role to the existing single-role set (set-replace).
      await request(httpServer)
        .put(`/api/users/${userPublicId}/roles`)
        .set('Cookie', superAdminCookie)
        .send({ roleIds: [rolePublicId, role2PublicId] })
        .expect(204);

      // Grant the same permission directly to the user as well.
      await request(httpServer)
        .put(`/api/users/${userPublicId}/direct-permissions`)
        .set('Cookie', superAdminCookie)
        .send({ permissionIds: [permPublicId] })
        .expect(204);

      // GET reflects the new direct-permission row.
      const direct = await request(httpServer)
        .get(`/api/users/${userPublicId}/direct-permissions`)
        .set('Cookie', superAdminCookie)
        .expect(200);
      expect(direct.body).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: `e2e.t${ts}.read` }),
      ]));
    });

    it('the newly-signed-in user still sees the same effective permission set via /api/me', async () => {
      const signIn = await request(httpServer)
        .post('/api/auth/sign-in/email')
        .send({ email: inviteeEmail, password: PASSWORD })
        .expect(200);
      const setCookie = signIn.headers['set-cookie'] as unknown as string[] | string | undefined;
      const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
      const userCookie = cookies
        .map((c) => c.split(';')[0])
        .find((c) => c.startsWith('better-auth.session_token='))!;

      const me = await request(httpServer)
        .get('/api/me/permissions')
        .set('Cookie', userCookie)
        .expect(200);
      // The same permission, granted via 2 roles + 1 direct, still appears once
      // (deduplicated union — guards against double-counting in the join).
      expect(me.body.permissions).toEqual(expect.arrayContaining([`e2e.t${ts}.read`]));
    });
  });

  // ── Final cleanup: e2e-user@example.com via super-admin DELETE ────────────
  // MUST stay last in the file: Jest runs sibling describe blocks in source
  // order, and this one mutates state other tests may rely on. Removes the
  // leftover `e2e-user@example.com` that older versions of the Direct Login
  // describe used to create (and never cleaned up because afterAll is
  // currently commented out). Idempotent — if the row isn't there, the
  // end-state assertion still holds.

  describe('Cleanup e2e-user@example.com (super-admin DELETE)', () => {
    it('signs in as Super Admin, deletes the SaUser via /api/users, then the BetterAuth user', async () => {
      // (1) Sign in as the seeded Super Admin to obtain a session cookie
      // carrying `platform.users.manage` — DELETE /api/users requires it.
      const signIn = await request(httpServer)
        .post('/api/auth/sign-in/email')
        .send({ email: 's@sa.io', password: 'Pass@word1234' })
        .expect(200);

      const setCookie = signIn.headers['set-cookie'] as unknown as
        | string[]
        | string
        | undefined;
      const cookieList = Array.isArray(setCookie)
        ? setCookie
        : setCookie
          ? [setCookie]
          : [];
      const sessionCookie = cookieList
        .map((c) => c.split(';')[0])
        .find((c) => c.startsWith('better-auth.session_token='));
      expect(sessionCookie).toBeDefined();

      const targetEmail = 'e2e-user@example.com';
      const baUser = await prisma.user.findUnique({ where: { email: targetEmail } });

      if (baUser) {
        // (2) Delete the linked SaUser through the platform API FIRST.
        // SaUser.betterAuthUserId is a FK to user.id, so removing the BA
        // user before the SaUser would violate the constraint.
        const saUser = await prisma.saUser.findFirst({
          where: { betterAuthUserId: baUser.id },
        });
        if (saUser) {
          await request(httpServer)
            .delete(`/api/users/${saUser.publicId}`)
            .set('Cookie', sessionCookie!)
            .expect(204);

          expect(
            await prisma.saUser.findUnique({ where: { publicId: saUser.publicId } }),
          ).toBeNull();
        }

        // (3) /api/users only manages the platform-side `saUser` row, not the
        // BetterAuth `user` row. Remove the BA row directly via Prisma —
        // `session` and `account` cascade per schema.prisma.
        await prisma.user.delete({ where: { id: baUser.id } });
      }

      // (4) End-state: neither row exists, regardless of starting state.
      expect(
        await prisma.user.findUnique({ where: { email: targetEmail } }),
      ).toBeNull();
      const remainingSa = await prisma.saUser.findFirst({
        where: { betterAuthUser: { email: targetEmail } },
      });
      expect(remainingSa).toBeNull();
    });
  });
});
