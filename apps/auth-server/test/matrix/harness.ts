/**
 * Per-spec-file Nest bootstrap + per-admin session cookie cache.
 * Each matrix spec calls bootApp() once in beforeAll and as(admin) per test.
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import * as path from 'path';
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
import { ADMIN_PASSWORD, SeedAdmin } from './permissions-matrix';

let sharedApp: INestApplication | null = null;
let sharedHttpServer: ReturnType<INestApplication['getHttpServer']> | null = null;
let sessionCookies: Map<string, string> = new Map();

/** Ensures crypto/env are seeded for the test process. Safe to call repeatedly. */
function ensureTestEnv() {
  if (process.env.RSA_PRIVATE_KEY && process.env.RSA_PUBLIC_KEY) return;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.RSA_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64');
  process.env.RSA_PUBLIC_KEY = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }) as string).toString('base64');
  process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? 'test-secret-at-least-32-chars-long!!';
}

/**
 * Boots NestJS once for the calling spec file. Migrations + seed are run on
 * first call only — subsequent calls return the cached app.
 *
 * Each *.matrix.e2e-spec.ts file should call this in its top-level beforeAll.
 */
export async function bootApp() {
  if (sharedApp && sharedHttpServer) {
    return { app: sharedApp, httpServer: sharedHttpServer };
  }

  ensureTestEnv();

  // Migrations + seed only on first boot per process.
  if (!process.env.MATRIX_DB_READY) {
    const { execSync } = await import('child_process');
    const dbRoot = path.resolve(__dirname, '../../../../packages/db');
    const prismaBin = path.join(dbRoot, 'node_modules/.bin/prisma');
    const schemaPath = path.join(dbRoot, 'schema.prisma');
    execSync(`${prismaBin} migrate deploy --schema=${schemaPath}`, { stdio: 'inherit' });
    execSync('pnpm seed', { stdio: 'inherit', cwd: process.cwd() });
    process.env.MATRIX_DB_READY = '1';
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

export async function closeApp() {
  if (sharedApp) {
    await sharedApp.close();
    sharedApp = null;
    sharedHttpServer = null;
    sessionCookies.clear();
  }
}

/**
 * Signs in via BetterAuth and returns the session cookie pair
 * (e.g. `better-auth.session_token=…`). Cached per email.
 */
export async function signInAs(email: string): Promise<string> {
  const cached = sessionCookies.get(email);
  if (cached) return cached;

  if (!sharedHttpServer) throw new Error('signInAs called before bootApp');

  const res = await request(sharedHttpServer)
    .post('/api/auth/sign-in/email')
    .send({ email, password: ADMIN_PASSWORD })
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

/** Returns a thin helper bound to one admin's session cookie. */
export function as(admin: SeedAdmin): {
  cookie(): Promise<string>;
  get(path: string): Promise<SuperResponse>;
  post(path: string, body: unknown): Promise<SuperResponse>;
  patch(path: string, body: unknown): Promise<SuperResponse>;
  del(path: string): Promise<SuperResponse>;
} {
  return {
    async cookie(): Promise<string> {
      return signInAs(admin.email);
    },
    async get(path: string) {
      const cookie = await signInAs(admin.email);
      return request(sharedHttpServer!).get(path).set('Cookie', cookie);
    },
    async post(path: string, body: unknown) {
      const cookie = await signInAs(admin.email);
      return request(sharedHttpServer!).post(path).set('Cookie', cookie).send(body as object);
    },
    async patch(path: string, body: unknown) {
      const cookie = await signInAs(admin.email);
      return request(sharedHttpServer!).patch(path).set('Cookie', cookie).send(body as object);
    },
    async del(path: string) {
      const cookie = await signInAs(admin.email);
      return request(sharedHttpServer!).delete(path).set('Cookie', cookie);
    },
  };
}
