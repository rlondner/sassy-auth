// dotenv must load BEFORE any module that reads DATABASE_URL / RSA keys /
// BETTER_AUTH_* (Prisma client, auth.config, etc.) — Prisma CLI does its
// own dotenv but the Prisma client runtime does not.
import 'dotenv/config';
import * as crypto from 'crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { prisma } from '@sassy-auth/db';
import { AppModule } from '../src/app.module';
import { auth } from '../src/auth/auth.config';
import { SentryExceptionFilter } from '../src/common/filters/sentry-exception.filter';
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
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new SentryExceptionFilter(new LoggerService()));
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
      expect(Array.isArray(decoded.permissions)).toBe(true);
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
      await request(httpServer)
        .post('/api/token/oauth/token')
        .send({
          code: 'bogus-code',
          client_id: platformAppPublicId,
          client_secret: 'any',
          redirect_uri: 'https://app.example.com/callback',
        })
        .expect(401);
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
