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
    // Run migrations on test DB
    const { execSync } = await import('child_process');
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });

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
    await prisma.saUserPermission.deleteMany();
    await prisma.saUserRole.deleteMany();
    await prisma.saRolePermission.deleteMany();
    await prisma.saUser.deleteMany();
    await prisma.saPermission.deleteMany({ where: { app: { isPlatform: false } } });
    await prisma.saRole.deleteMany();
    await prisma.saOrg.deleteMany({ where: { isPlatform: false } });
    await prisma.account.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
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
});
