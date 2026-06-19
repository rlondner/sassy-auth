/**
 * Sign-in + request helpers for the multi-tenant demo scenario. Mirrors
 * the matrix harness shape (bootApp / signInAs / as) but keyed off the
 * SEED_DEMO_MULTITENANT users instead of SEED_ADMINS.
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import express from 'express';
import request, { Response as SuperResponse } from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from '../../src/app.module';
import { auth } from '../../src/auth/auth.config';
import { SentryExceptionFilter } from '../../src/common/filters/sentry-exception.filter';
import { LoggerService } from '../../src/common/logger/logger.service';

export const DEMO_PASSWORD = 'Pass@word1234';

export const DEMO_USERS = {
  acmeAdmin:   'acme-admin@app01.io',
  acmeAlice:   'acme-alice@app01.io',
  acmeBob:     'acme-bob@app01.io',
  globexAdmin: 'globex-admin@app01.io',
  globexGina:  'globex-gina@app01.io',
  globexGreg:  'globex-greg@app01.io',
} as const;

let sharedApp: INestApplication | null = null;
let sharedHttpServer: ReturnType<INestApplication['getHttpServer']> | null = null;
const sessionCookies = new Map<string, string>();

function ensureTestEnv() {
  if (process.env.RSA_PRIVATE_KEY && process.env.RSA_PUBLIC_KEY) return;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.RSA_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64');
  process.env.RSA_PUBLIC_KEY = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }) as string).toString('base64');
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-chars-long!!';
}

export async function bootScenarioApp() {
  if (sharedApp && sharedHttpServer) {
    return { app: sharedApp, httpServer: sharedHttpServer };
  }
  ensureTestEnv();

  // Migrations + platform seed + demo seed (idempotent).
  if (!process.env.SCENARIO_DB_READY) {
    const { execSync } = await import('child_process');
    execSync(
      'npx prisma migrate deploy --schema=../../packages/db/schema.prisma',
      { stdio: 'inherit' },
    );
    execSync('pnpm seed', {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, SEED_DEMO_MULTITENANT: '1' },
    });
    process.env.SCENARIO_DB_READY = '1';
  }

  const expressApp = express();
  expressApp.all('/api/auth/*', toNodeHandler(auth));

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication(new ExpressAdapter(expressApp));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new SentryExceptionFilter(new LoggerService()));
  await app.init();

  sharedApp = app;
  sharedHttpServer = app.getHttpServer();
  return { app, httpServer: sharedHttpServer };
}

export async function closeScenarioApp() {
  if (sharedApp) {
    await sharedApp.close();
    sharedApp = null;
    sharedHttpServer = null;
    sessionCookies.clear();
  }
}

export async function signInAs(email: string): Promise<string> {
  const cached = sessionCookies.get(email);
  if (cached) return cached;

  if (!sharedHttpServer) throw new Error('signInAs called before bootScenarioApp');

  const res = await request(sharedHttpServer)
    .post('/api/auth/sign-in/email')
    .send({ email, password: DEMO_PASSWORD })
    .expect(200);

  const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const pair = arr
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('better-auth.session_token='));

  if (!pair) throw new Error(`No session cookie in sign-in response for ${email}`);

  sessionCookies.set(email, pair);
  return pair;
}

export function asEmail(email: string): {
  get(path: string): Promise<SuperResponse>;
  post(path: string, body: unknown): Promise<SuperResponse>;
  patch(path: string, body: unknown): Promise<SuperResponse>;
  put(path: string, body: unknown): Promise<SuperResponse>;
  del(path: string): Promise<SuperResponse>;
} {
  return {
    async get(path) {
      const cookie = await signInAs(email);
      return request(sharedHttpServer!).get(path).set('Cookie', cookie);
    },
    async post(path, body) {
      const cookie = await signInAs(email);
      return request(sharedHttpServer!).post(path).set('Cookie', cookie).send(body as object);
    },
    async patch(path, body) {
      const cookie = await signInAs(email);
      return request(sharedHttpServer!).patch(path).set('Cookie', cookie).send(body as object);
    },
    async put(path, body) {
      const cookie = await signInAs(email);
      return request(sharedHttpServer!).put(path).set('Cookie', cookie).send(body as object);
    },
    async del(path) {
      const cookie = await signInAs(email);
      return request(sharedHttpServer!).delete(path).set('Cookie', cookie);
    },
  };
}

/** Returns publicId of org by name within the demo app. */
export async function demoOrgIdByName(name: 'Acme' | 'Globex'): Promise<string> {
  const { prisma } = await import('@sassy-auth/db');
  const app = await prisma.saApp.findUnique({ where: { name: 'app01' } });
  if (!app) throw new Error('app01 not seeded — set SEED_DEMO_MULTITENANT=1');
  const org = await prisma.saOrg.findFirst({ where: { appId: app.id, name } });
  if (!org) throw new Error(`Demo org ${name} not seeded`);
  return org.publicId;
}

/** Returns publicId of a demo user by email. */
export async function demoUserIdByEmail(email: string): Promise<string> {
  const { prisma } = await import('@sassy-auth/db');
  const ba = await prisma.user.findUnique({ where: { email } });
  if (!ba) throw new Error(`Demo user ${email} not seeded`);
  const sa = await prisma.saUser.findUnique({ where: { betterAuthUserId: ba.id } });
  if (!sa) throw new Error(`SaUser for ${email} not found`);
  return sa.publicId;
}

/** Returns publicId of an app-perm by name within app01. */
export async function demoPermIdByName(name: 'contracts.read' | 'contracts.create' | 'org.users.manage' | 'org.roles.manage' | 'platform.users.manage'): Promise<string> {
  const { prisma } = await import('@sassy-auth/db');
  const perm = await prisma.saPermission.findUnique({ where: { name } });
  if (!perm) throw new Error(`Demo perm ${name} not seeded`);
  return perm.publicId;
}
