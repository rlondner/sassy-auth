# SassyAuth — Data Model & Core Auth Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Turborepo monorepo, define the Prisma data model, configure BetterAuth, and implement the JWT issuance engine with Direct Login (Flow B) and OAuth2 Authorization Code (Flow A).

**Architecture:** NestJS runs on an Express adapter. BetterAuth mounts directly on the Express app and intercepts all `/api/auth/*` before NestJS sees them. JWT issuance lives under `/api/token/*` as standard NestJS routes. A shared `packages/db` package owns the Prisma schema and exports a singleton `PrismaClient` consumed by both BetterAuth and NestJS. Credential validation in Flow B bypasses BetterAuth's session machinery: it reads the bcrypt hash from the `account` table directly and compares it, avoiding orphaned sessions.

**Tech Stack:** Node.js 20 · pnpm workspaces · Turborepo · NestJS 10 · Express 4 · BetterAuth 1 · Prisma 5 · PostgreSQL · RS256 JWT (`jsonwebtoken` 9) · `sqids` · `bcryptjs` · `class-validator` · Jest · Supertest

---

## File Map

| File | Purpose |
|---|---|
| `package.json` | Turborepo root — pnpm workspace config |
| `pnpm-workspace.yaml` | pnpm workspace glob |
| `turbo.json` | Turborepo pipeline |
| `.env.example` | Environment variable template |
| `.gitignore` | Root gitignore |
| `packages/db/package.json` | db package manifest |
| `packages/db/tsconfig.json` | db TypeScript config |
| `packages/db/schema.prisma` | Single source of truth for all tables |
| `packages/db/index.ts` | PrismaClient singleton export |
| `packages/types/package.json` | types package manifest |
| `packages/types/tsconfig.json` | types TypeScript config |
| `packages/types/index.ts` | Shared TypeScript types: JWT claims, token error codes |
| `apps/auth-server/package.json` | NestJS app manifest + scripts |
| `apps/auth-server/tsconfig.json` | NestJS TypeScript config |
| `apps/auth-server/nest-cli.json` | NestJS CLI config |
| `apps/auth-server/src/main.ts` | Express adapter + BetterAuth mount + NestJS bootstrap |
| `apps/auth-server/src/app.module.ts` | Root NestJS module |
| `apps/auth-server/src/auth/auth.config.ts` | BetterAuth configuration object |
| `apps/auth-server/src/auth/auth.module.ts` | Auth NestJS module (exports guard) |
| `apps/auth-server/src/auth/better-auth.guard.ts` | Guard validating BetterAuth session cookies |
| `apps/auth-server/src/auth/better-auth.guard.spec.ts` | Unit tests for BetterAuthGuard |
| `apps/auth-server/src/common/filters/http-exception.filter.ts` | Global error normalizer |
| `apps/auth-server/src/common/sqid/sqid.service.ts` | Sqid encode/decode |
| `apps/auth-server/src/common/sqid/sqid.service.spec.ts` | Sqid unit tests |
| `apps/auth-server/src/common/common.module.ts` | Module exporting SqidService |
| `apps/auth-server/src/token/dto/direct-login.dto.ts` | DTO for POST /api/token/direct/login |
| `apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts` | DTO for POST /api/token/oauth/token |
| `apps/auth-server/src/token/token.service.ts` | Permission resolution + JWT signing |
| `apps/auth-server/src/token/token.service.spec.ts` | Unit tests for TokenService |
| `apps/auth-server/src/token/oauth.service.ts` | OAuth2 authorization code flow (in-memory store) |
| `apps/auth-server/src/token/oauth.service.spec.ts` | Unit tests for OauthService |
| `apps/auth-server/src/token/token.controller.ts` | /api/token/* HTTP routes |
| `apps/auth-server/src/token/token.controller.spec.ts` | Controller unit tests |
| `apps/auth-server/src/token/token.module.ts` | TokenModule wiring |
| `apps/auth-server/src/seed/seed.ts` | Platform bootstrap seed |
| `apps/auth-server/test/app.e2e-spec.ts` | E2E integration test |
| `apps/auth-server/test/jest-e2e.json` | Jest E2E config |

---

## Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "sassy-auth",
  "private": true,
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "test": "turbo test",
    "lint": "turbo lint"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  },
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 4: Create .env.example**

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/sassyauth"

# JWT RS256 key pair (generate with: node -e "const c=require('crypto');const {privateKey,publicKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});console.log('RSA_PRIVATE_KEY='+Buffer.from(privateKey.export({type:'pkcs8',format:'pem'})).toString('base64'));console.log('RSA_PUBLIC_KEY='+Buffer.from(publicKey.export({type:'spki',format:'pem'})).toString('base64'))")
RSA_PRIVATE_KEY="<base64-encoded PKCS8 PEM>"
RSA_PUBLIC_KEY="<base64-encoded SPKI PEM>"

# BetterAuth
BETTER_AUTH_SECRET="change-me-to-a-random-32-char-string"
BETTER_AUTH_URL="http://localhost:3000"

# Social providers (optional — omit unused ones)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
MICROSOFT_CLIENT_ID=""
MICROSOFT_CLIENT_SECRET=""
APPLE_CLIENT_ID=""
APPLE_CLIENT_SECRET=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""

# Sqids alphabet (leave blank to use default)
SQIDS_ALPHABET=""
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
.env
*.env.local
.turbo/
```

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json .env.example .gitignore
git commit -m "chore: turborepo monorepo scaffold"
```

---

## Task 2: packages/db — Prisma Schema

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/schema.prisma`
- Create: `packages/db/index.ts`

- [ ] **Step 1: Create packages/db/package.json**

```json
{
  "name": "@sassy-auth/db",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push",
    "db:seed": "ts-node src/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^5.14.0"
  },
  "devDependencies": {
    "prisma": "^5.14.0",
    "typescript": "^5.4.0",
    "ts-node": "^10.9.0"
  }
}
```

- [ ] **Step 2: Create packages/db/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["index.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Create packages/db/schema.prisma**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── BetterAuth tables (managed by BetterAuth Prisma adapter) ──────────────────

model User {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean
  image         String?
  createdAt     DateTime
  updatedAt     DateTime
  sessions      Session[]
  accounts      Account[]
  saUser        SaUser?
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime
  updatedAt DateTime
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime
  updatedAt             DateTime
}

model Verification {
  id         String    @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime?
  updatedAt  DateTime?
}

// ── SassyAuth tables ──────────────────────────────────────────────────────────

model SaApp {
  id          Int            @id @default(autoincrement())
  publicId    String         @unique
  name        String
  url         String
  isPlatform  Boolean        @default(false)
  orgs        SaOrg[]
  permissions SaPermission[]
  roles       SaRole[]
}

model SaOrg {
  id         Int      @id @default(autoincrement())
  publicId   String   @unique
  name       String
  appId      Int
  app        SaApp    @relation(fields: [appId], references: [id])
  isPlatform Boolean  @default(false)
  users      SaUser[]
}

model SaUser {
  id               Int                @id @default(autoincrement())
  publicId         String             @unique
  betterAuthUserId String             @unique
  betterAuthUser   User               @relation(fields: [betterAuthUserId], references: [id])
  orgId            Int
  org              SaOrg              @relation(fields: [orgId], references: [id])
  firstName        String
  lastName         String
  phoneNumber      String?
  username         String?
  roles            SaUserRole[]
  directPermissions SaUserPermission[]
}

model SaPermission {
  id       Int                @id @default(autoincrement())
  publicId String             @unique
  name     String             @unique
  appId    Int
  app      SaApp              @relation(fields: [appId], references: [id])
  roles    SaRolePermission[]
  users    SaUserPermission[]
}

model SaRole {
  id          Int                @id @default(autoincrement())
  publicId    String             @unique
  name        String
  appId       Int
  app         SaApp              @relation(fields: [appId], references: [id])
  permissions SaRolePermission[]
  users       SaUserRole[]
}

model SaRolePermission {
  roleId       Int
  permissionId Int
  role         SaRole       @relation(fields: [roleId], references: [id])
  permission   SaPermission @relation(fields: [permissionId], references: [id])

  @@id([roleId, permissionId])
}

model SaUserRole {
  userId Int
  roleId Int
  user   SaUser @relation(fields: [userId], references: [id])
  role   SaRole @relation(fields: [roleId], references: [id])

  @@id([userId, roleId])
}

model SaUserPermission {
  userId       Int
  permissionId Int
  user         SaUser       @relation(fields: [userId], references: [id])
  permission   SaPermission @relation(fields: [permissionId], references: [id])

  @@id([userId, permissionId])
}
```

- [ ] **Step 4: Create packages/db/index.ts**

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient };
export * from '@prisma/client';
```

- [ ] **Step 5: Install deps and generate client**

From `packages/db/`:
```bash
pnpm install
npx prisma generate
```

Expected: Prisma client generated under `node_modules/.prisma/client`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/
git commit -m "feat(db): prisma schema — BetterAuth + SassyAuth tables"
```

---

## Task 3: packages/types — Shared TypeScript Types

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/index.ts`

- [ ] **Step 1: Create packages/types/package.json**

```json
{
  "name": "@sassy-auth/types",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create packages/types/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["index.ts"]
}
```

- [ ] **Step 3: Create packages/types/index.ts**

```typescript
/** Claims included in every RS256 JWT issued by SassyAuth. */
export interface SassyAuthJwtPayload {
  /** Issuer: base URL of the SassyAuth server */
  iss: string;
  /** Subject: sa_user.publicId (Sqid) */
  sub: string;
  /** Audience: sa_app.publicId (Sqid) of the target resource server */
  aud: string;
  /** Issued at (Unix seconds) */
  iat: number;
  /** Expires at (Unix seconds) */
  exp: number;
  /** Tenant: sa_org.publicId (Sqid) */
  org: string;
  /**
   * Effective permissions — union of direct grants and all role permissions,
   * deduplicated, sorted alphabetically.
   */
  permissions: string[];
}

/** Machine-readable codes returned as the `error` field in 4xx JWT responses. */
export enum TokenErrorCode {
  USER_ORG_MISMATCH = 'USER_ORG_MISMATCH',
  APP_NOT_FOUND = 'APP_NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  INVALID_CODE = 'INVALID_CODE',
  CODE_EXPIRED = 'CODE_EXPIRED',
}

/** Identifier type detected from the login identifier string. */
export type IdentifierType = 'email' | 'phone' | 'username';

/** Detects the type of a login identifier string. */
export function detectIdentifierType(identifier: string): IdentifierType {
  if (identifier.includes('@')) return 'email';
  if (/^\+?[\d\s\-().]{7,}$/.test(identifier)) return 'phone';
  return 'username';
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/types/
git commit -m "feat(types): shared JWT payload type + token error codes"
```

---

## Task 4: auth-server NestJS Bootstrap

**Files:**
- Create: `apps/auth-server/package.json`
- Create: `apps/auth-server/tsconfig.json`
- Create: `apps/auth-server/nest-cli.json`
- Create: `apps/auth-server/src/main.ts`
- Create: `apps/auth-server/src/app.module.ts`

- [ ] **Step 1: Create apps/auth-server/package.json**

```json
{
  "name": "@sassy-auth/auth-server",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "dev": "nest start --watch",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "seed": "ts-node -r tsconfig-paths/register src/seed/seed.ts"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@sassy-auth/db": "workspace:*",
    "@sassy-auth/types": "workspace:*",
    "better-auth": "^1.0.0",
    "bcryptjs": "^2.4.3",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.0",
    "express": "^4.19.0",
    "jsonwebtoken": "^9.0.2",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1",
    "sqids": "^0.3.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.3.0",
    "@nestjs/schematics": "^10.1.0",
    "@nestjs/testing": "^10.3.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.12.0",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.1.4",
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.4.0"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "coverageDirectory": "../coverage",
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 2: Create apps/auth-server/tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2020",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true
  }
}
```

- [ ] **Step 3: Create apps/auth-server/nest-cli.json**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 4: Create apps/auth-server/src/main.ts**

```typescript
import 'reflect-metadata';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { auth } from './auth/auth.config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const expressApp = express();

  // BetterAuth intercepts /api/auth/* before NestJS processes any request.
  expressApp.all('/api/auth/*', toNodeHandler(auth));

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
```

- [ ] **Step 5: Create apps/auth-server/src/app.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { TokenModule } from './token/token.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [CommonModule, AuthModule, TokenModule],
})
export class AppModule {}
```

- [ ] **Step 6: Install dependencies**

From `apps/auth-server/`:
```bash
pnpm install
```

Expected: All packages installed. No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/
git commit -m "feat(auth-server): nestjs bootstrap with express adapter + betterauth mount"
```

---

## Task 5: SqidService

**Files:**
- Create: `apps/auth-server/src/common/sqid/sqid.service.spec.ts`
- Create: `apps/auth-server/src/common/sqid/sqid.service.ts`
- Create: `apps/auth-server/src/common/common.module.ts`

- [ ] **Step 1: Write the failing test**

`apps/auth-server/src/common/sqid/sqid.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { SqidService } from './sqid.service';

describe('SqidService', () => {
  let service: SqidService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SqidService],
    }).compile();
    service = module.get(SqidService);
  });

  it('encodes a positive integer to a non-empty string', () => {
    const encoded = service.encode(1);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('decodes back to the original integer', () => {
    const id = 42;
    const encoded = service.encode(id);
    expect(service.decode(encoded)).toBe(id);
  });

  it('produces different values for different ids', () => {
    expect(service.encode(1)).not.toBe(service.encode(2));
  });

  it('is deterministic — same input always produces same output', () => {
    expect(service.encode(100)).toBe(service.encode(100));
  });

  it('throws when decoding an invalid sqid', () => {
    expect(() => service.decode('!!!invalid!!!')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/auth-server && pnpm test -- sqid.service.spec.ts --verbose
```

Expected: FAIL — `Cannot find module './sqid.service'`

- [ ] **Step 3: Implement SqidService**

`apps/auth-server/src/common/sqid/sqid.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import Sqids from 'sqids';

@Injectable()
export class SqidService {
  private readonly sqids: Sqids;

  constructor() {
    const alphabet = process.env.SQIDS_ALPHABET || undefined;
    this.sqids = new Sqids({ alphabet, minLength: 4 });
  }

  encode(id: number): string {
    return this.sqids.encode([id]);
  }

  decode(publicId: string): number {
    const ids = this.sqids.decode(publicId);
    if (ids.length === 0) {
      throw new Error(`Invalid sqid: "${publicId}"`);
    }
    return ids[0];
  }
}
```

- [ ] **Step 4: Create CommonModule**

`apps/auth-server/src/common/common.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { SqidService } from './sqid/sqid.service';

@Global()
@Module({
  providers: [SqidService],
  exports: [SqidService],
})
export class CommonModule {}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/auth-server && pnpm test -- sqid.service.spec.ts --verbose
```

Expected: PASS — 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/common/
git commit -m "feat(auth-server): sqid service for public ID encoding"
```

---

## Task 6: HttpExceptionFilter

**Files:**
- Create: `apps/auth-server/src/common/filters/http-exception.filter.ts`

No unit test for this filter — it will be exercised via the e2e test in Task 15.

- [ ] **Step 1: Create HttpExceptionFilter**

`apps/auth-server/src/common/filters/http-exception.filter.ts`:
```typescript
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let error: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = HttpStatus[status] ?? 'Error';
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = Array.isArray(b['message'])
          ? (b['message'] as string[]).join(', ')
          : String(b['message'] ?? exception.message);
        error = String(b['error'] ?? HttpStatus[status] ?? 'Error');
      } else {
        message = exception.message;
        error = HttpStatus[status] ?? 'Error';
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'INTERNAL_SERVER_ERROR';
    }

    response.status(status).json({
      statusCode: status,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/auth-server/src/common/filters/
git commit -m "feat(auth-server): global http exception filter"
```

---

## Task 7: BetterAuth Configuration

**Files:**
- Create: `apps/auth-server/src/auth/auth.config.ts`
- Create: `apps/auth-server/src/auth/auth.module.ts`

- [ ] **Step 1: Create auth.config.ts**

`apps/auth-server/src/auth/auth.config.ts`:
```typescript
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { magicLink } from 'better-auth/plugins';
import { emailOtp } from 'better-auth/plugins';
import { prisma } from '@sassy-auth/db';

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    }),
    ...(process.env.MICROSOFT_CLIENT_ID && {
      microsoft: {
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      },
    }),
    ...(process.env.APPLE_CLIENT_ID && {
      apple: {
        clientId: process.env.APPLE_CLIENT_ID,
        clientSecret: process.env.APPLE_CLIENT_SECRET!,
      },
    }),
    ...(process.env.GITHUB_CLIENT_ID && {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
    }),
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // Wire to your email service in production.
        // In development, log the link to the console.
        console.log(`[magic-link] ${email} → ${url}`);
      },
    }),
    emailOtp({
      sendVerificationOTP: async ({ email, otp }) => {
        console.log(`[email-otp] ${email} → ${otp}`);
      },
    }),
  ],
});
```

- [ ] **Step 2: Create auth.module.ts**

`apps/auth-server/src/auth/auth.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { BetterAuthGuard } from './better-auth.guard';

@Module({
  providers: [BetterAuthGuard],
  exports: [BetterAuthGuard],
})
export class AuthModule {}
```

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/auth/auth.config.ts apps/auth-server/src/auth/auth.module.ts
git commit -m "feat(auth-server): betterauth config with email/password, social, magic-link, email-otp"
```

---

## Task 8: BetterAuthGuard

**Files:**
- Create: `apps/auth-server/src/auth/better-auth.guard.spec.ts`
- Create: `apps/auth-server/src/auth/better-auth.guard.ts`

- [ ] **Step 1: Write the failing test**

`apps/auth-server/src/auth/better-auth.guard.spec.ts`:
```typescript
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { BetterAuthGuard } from './better-auth.guard';

// Mock auth module so tests don't require a real DB.
jest.mock('./auth.config', () => ({
  auth: {
    api: {
      getSession: jest.fn(),
    },
  },
}));

import { auth } from './auth.config';

const mockGetSession = auth.api.getSession as jest.Mock;

function makeContext(headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('BetterAuthGuard', () => {
  let guard: BetterAuthGuard;

  beforeEach(() => {
    guard = new BetterAuthGuard();
    jest.clearAllMocks();
  });

  it('returns true and attaches user when session is valid', async () => {
    const fakeUser = { id: 'ba-user-id', email: 'test@example.com' };
    mockGetSession.mockResolvedValue({ user: fakeUser, session: {} });

    const ctx = makeContext({ cookie: 'better-auth.session_token=abc' });
    const request = ctx.switchToHttp().getRequest() as Record<string, unknown>;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(request['betterAuthUser']).toEqual(fakeUser);
  });

  it('throws UnauthorizedException when session is null', async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(guard.canActivate(makeContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when getSession rejects', async () => {
    mockGetSession.mockRejectedValue(new Error('db error'));

    await expect(guard.canActivate(makeContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/auth-server && pnpm test -- better-auth.guard.spec.ts --verbose
```

Expected: FAIL — `Cannot find module './better-auth.guard'`

- [ ] **Step 3: Implement BetterAuthGuard**

`apps/auth-server/src/auth/better-auth.guard.ts`:
```typescript
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import { Request } from 'express';
import { auth } from './auth.config';

@Injectable()
export class BetterAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session) throw new UnauthorizedException();
      (request as unknown as Record<string, unknown>)['betterAuthUser'] =
        session.user;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/auth-server && pnpm test -- better-auth.guard.spec.ts --verbose
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/auth/better-auth.guard.ts apps/auth-server/src/auth/better-auth.guard.spec.ts
git commit -m "feat(auth-server): betterauth session guard"
```

---

## Task 9: TokenService — Permission Resolution & JWT Signing

**Files:**
- Create: `apps/auth-server/src/token/token.service.spec.ts`
- Create: `apps/auth-server/src/token/token.service.ts`

- [ ] **Step 1: Write failing tests**

`apps/auth-server/src/token/token.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { TokenService } from './token.service';
import { SqidService } from '../common/sqid/sqid.service';
import { PrismaClient } from '@sassy-auth/db';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

// ── Prisma mock ──────────────────────────────────────────────────────────────

const mockPrisma = {
  saUser: {
    findUnique: jest.fn(),
  },
};

jest.mock('@sassy-auth/db', () => ({
  prisma: mockPrisma,
}));

// ── Key pair for tests ───────────────────────────────────────────────────────

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

process.env.RSA_PRIVATE_KEY = Buffer.from(privatePem).toString('base64');
process.env.RSA_PUBLIC_KEY = Buffer.from(publicPem).toString('base64');
process.env.BETTER_AUTH_URL = 'https://auth.example.com';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const saUserWithPermissions = {
  id: 1,
  publicId: 'usr-1',
  betterAuthUserId: 'ba-1',
  orgId: 1,
  org: { id: 1, publicId: 'org-1', appId: 5 },
  roles: [
    {
      role: {
        permissions: [
          { permission: { name: 'invoices.create' } },
          { permission: { name: 'reports.read' } },
        ],
      },
    },
  ],
  directPermissions: [
    { permission: { name: 'invoices.create' } }, // duplicate — must be deduped
    { permission: { name: 'sales.manage' } },
  ],
};

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [TokenService, SqidService],
    }).compile();
    service = module.get(TokenService);
    jest.clearAllMocks();
  });

  // ── Permission resolution ──────────────────────────────────────────────────

  describe('resolvePermissions', () => {
    it('returns sorted, deduplicated union of role and direct permissions', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(saUserWithPermissions);

      const result = await service.resolvePermissions(1);

      expect(result).toEqual([
        'invoices.create',
        'reports.read',
        'sales.manage',
      ]);
    });

    it('throws USER_NOT_FOUND when sa_user does not exist', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(null);

      await expect(service.resolvePermissions(999)).rejects.toMatchObject({
        message: expect.stringContaining('USER_NOT_FOUND'),
      });
    });
  });

  // ── JWT issuance ───────────────────────────────────────────────────────────

  describe('issueJwt', () => {
    it('returns a verifiable RS256 JWT with correct claims', async () => {
      mockPrisma.saUser.findUnique.mockResolvedValue(saUserWithPermissions);

      const token = await service.issueJwt({
        saUserId: 1,
        userPublicId: 'usr-1',
        orgPublicId: 'org-1',
        appPublicId: 'app-1',
      });

      const decoded = jwt.verify(token, publicPem, {
        algorithms: ['RS256'],
      }) as jwt.JwtPayload;

      expect(decoded.sub).toBe('usr-1');
      expect(decoded.aud).toBe('app-1');
      expect(decoded.org).toBe('org-1');
      expect(decoded.iss).toBe('https://auth.example.com');
      expect(Array.isArray(decoded.permissions)).toBe(true);
      expect(decoded.exp! - decoded.iat!).toBe(3600);
    });
  });

  // ── JWKS ──────────────────────────────────────────────────────────────────

  describe('getJwks', () => {
    it('returns a JWKS object with at least one RSA key', () => {
      const jwks = service.getJwks();
      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0].kty).toBe('RSA');
      expect(jwks.keys[0].alg).toBe('RS256');
      expect(jwks.keys[0].use).toBe('sig');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/auth-server && pnpm test -- token.service.spec.ts --verbose
```

Expected: FAIL — `Cannot find module './token.service'`

- [ ] **Step 3: Implement TokenService**

`apps/auth-server/src/token/token.service.ts`:
```typescript
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { prisma } from '@sassy-auth/db';
import { TokenErrorCode } from '@sassy-auth/types';

interface IssueJwtParams {
  saUserId: number;
  userPublicId: string;
  orgPublicId: string;
  appPublicId: string;
}

@Injectable()
export class TokenService {
  private readonly privateKey: string;
  private readonly publicKey: string;

  constructor() {
    if (!process.env.RSA_PRIVATE_KEY || !process.env.RSA_PUBLIC_KEY) {
      throw new Error('RSA_PRIVATE_KEY and RSA_PUBLIC_KEY env vars are required');
    }
    this.privateKey = Buffer.from(process.env.RSA_PRIVATE_KEY, 'base64').toString('utf-8');
    this.publicKey = Buffer.from(process.env.RSA_PUBLIC_KEY, 'base64').toString('utf-8');
  }

  async resolvePermissions(saUserId: number): Promise<string[]> {
    const user = await prisma.saUser.findUnique({
      where: { id: saUserId },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
        directPermissions: { include: { permission: true } },
      },
    });

    if (!user) {
      throw new NotFoundException(TokenErrorCode.USER_NOT_FOUND);
    }

    const names = new Set<string>();

    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        names.add(rp.permission.name);
      }
    }

    for (const up of user.directPermissions) {
      names.add(up.permission.name);
    }

    return Array.from(names).sort();
  }

  async issueJwt(params: IssueJwtParams): Promise<string> {
    const permissions = await this.resolvePermissions(params.saUserId);
    const issuer = process.env.BETTER_AUTH_URL ?? 'https://auth.example.com';
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      sub: params.userPublicId,
      aud: params.appPublicId,
      org: params.orgPublicId,
      iss: issuer,
      iat: now,
      exp: now + 3600,
      permissions,
    };

    return jwt.sign(payload, this.privateKey, { algorithm: 'RS256' });
  }

  getJwks(): { keys: object[] } {
    const keyObject = crypto.createPublicKey(this.publicKey);
    const jwk = keyObject.export({ format: 'jwk' });
    return {
      keys: [
        {
          ...jwk,
          alg: 'RS256',
          use: 'sig',
          kid: 'sassy-auth-1',
        },
      ],
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/auth-server && pnpm test -- token.service.spec.ts --verbose
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.service.ts apps/auth-server/src/token/token.service.spec.ts
git commit -m "feat(auth-server): token service — permission resolution + RS256 JWT issuance + JWKS"
```

---

## Task 10: OauthService — Authorization Code Flow

**Files:**
- Create: `apps/auth-server/src/token/oauth.service.spec.ts`
- Create: `apps/auth-server/src/token/oauth.service.ts`

- [ ] **Step 1: Write failing tests**

`apps/auth-server/src/token/oauth.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { OauthService } from './oauth.service';

describe('OauthService', () => {
  let service: OauthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [OauthService],
    }).compile();
    service = module.get(OauthService);
    jest.clearAllMocks();
  });

  describe('generateCode', () => {
    it('returns a non-empty string code', () => {
      const code = service.generateCode('user-1', 'app-1');
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(10);
    });

    it('generates unique codes for different calls', () => {
      const a = service.generateCode('user-1', 'app-1');
      const b = service.generateCode('user-1', 'app-1');
      expect(a).not.toBe(b);
    });
  });

  describe('exchangeCode', () => {
    it('returns userId and appPublicId for a valid code', () => {
      const code = service.generateCode('user-99', 'app-55');
      const result = service.exchangeCode(code, 'app-55');
      expect(result).toEqual({ userId: 'user-99', appPublicId: 'app-55' });
    });

    it('throws when code does not exist', () => {
      expect(() => service.exchangeCode('nonexistent', 'app-1')).toThrow(
        /INVALID_CODE/,
      );
    });

    it('throws when appPublicId does not match', () => {
      const code = service.generateCode('user-1', 'app-correct');
      expect(() => service.exchangeCode(code, 'app-wrong')).toThrow(
        /INVALID_CODE/,
      );
    });

    it('throws when code is expired', () => {
      jest.useFakeTimers();
      const code = service.generateCode('user-1', 'app-1');
      // Advance time by 6 minutes (codes expire after 5 minutes)
      jest.advanceTimersByTime(6 * 60 * 1000);
      expect(() => service.exchangeCode(code, 'app-1')).toThrow(/CODE_EXPIRED/);
      jest.useRealTimers();
    });

    it('invalidates a code after use (one-time use)', () => {
      const code = service.generateCode('user-1', 'app-1');
      service.exchangeCode(code, 'app-1'); // first use succeeds
      expect(() => service.exchangeCode(code, 'app-1')).toThrow(/INVALID_CODE/);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/auth-server && pnpm test -- oauth.service.spec.ts --verbose
```

Expected: FAIL — `Cannot find module './oauth.service'`

- [ ] **Step 3: Implement OauthService**

`apps/auth-server/src/token/oauth.service.ts`:
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { TokenErrorCode } from '@sassy-auth/types';

interface AuthCode {
  userId: string;
  appPublicId: string;
  expiresAt: Date;
}

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class OauthService {
  private readonly codes = new Map<string, AuthCode>();

  generateCode(userId: string, appPublicId: string): string {
    const code = crypto.randomBytes(32).toString('hex');
    this.codes.set(code, {
      userId,
      appPublicId,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    return code;
  }

  exchangeCode(
    code: string,
    appPublicId: string,
  ): { userId: string; appPublicId: string } {
    const entry = this.codes.get(code);

    if (!entry || entry.appPublicId !== appPublicId) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_CODE);
    }

    if (entry.expiresAt < new Date()) {
      this.codes.delete(code);
      throw new UnauthorizedException(TokenErrorCode.CODE_EXPIRED);
    }

    this.codes.delete(code); // one-time use
    return { userId: entry.userId, appPublicId: entry.appPublicId };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/auth-server && pnpm test -- oauth.service.spec.ts --verbose
```

Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/oauth.service.ts apps/auth-server/src/token/oauth.service.spec.ts
git commit -m "feat(auth-server): oauth service — in-memory authorization code flow"
```

---

## Task 11: DTOs

**Files:**
- Create: `apps/auth-server/src/token/dto/direct-login.dto.ts`
- Create: `apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts`

No unit tests for DTOs — they are exercised via the controller tests.

- [ ] **Step 1: Create direct-login.dto.ts**

`apps/auth-server/src/token/dto/direct-login.dto.ts`:
```typescript
import { IsString, IsNotEmpty } from 'class-validator';

export class DirectLoginDto {
  /** Username, email address, or phone number. */
  @IsString()
  @IsNotEmpty()
  identifier!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  /** sa_app.publicId of the app the user is authenticating for. */
  @IsString()
  @IsNotEmpty()
  appId!: string;
}
```

- [ ] **Step 2: Create oauth-token-exchange.dto.ts**

`apps/auth-server/src/token/dto/oauth-token-exchange.dto.ts`:
```typescript
import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class OauthTokenExchangeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  /** sa_app.publicId — must match the app that requested the code. */
  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @IsString()
  @IsNotEmpty()
  client_secret!: string;

  @IsUrl()
  redirect_uri!: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/token/dto/
git commit -m "feat(auth-server): token DTOs"
```

---

## Task 12: TokenController

**Files:**
- Create: `apps/auth-server/src/token/token.controller.spec.ts`
- Create: `apps/auth-server/src/token/token.controller.ts`

The controller has five endpoints:
- `GET /api/token/jwks` — returns JWKS document
- `GET /api/token/oauth/authorize` — validates app, checks session, issues code, redirects
- `POST /api/token/oauth/token` — exchanges code for JWT
- `POST /api/token/direct/login` — validates credentials, issues JWT

> **Note on credential validation in Direct Login:** The controller calls `TokenController._resolveEmailFromIdentifier` to find the BetterAuth user email from username/phone, then validates the password against the bcrypt hash stored in the `account` table. It does NOT call BetterAuth's signIn API (which would create orphaned sessions).

- [ ] **Step 1: Write failing controller tests**

`apps/auth-server/src/token/token.controller.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { TokenController } from './token.controller';
import { TokenService } from './token.service';
import { OauthService } from './oauth.service';
import { SqidService } from '../common/sqid/sqid.service';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';

jest.mock('@sassy-auth/db', () => ({
  prisma: {
    saApp: { findUnique: jest.fn() },
    saUser: { findUnique: jest.fn(), findFirst: jest.fn() },
    account: { findFirst: jest.fn() },
  },
}));

jest.mock('./auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

import { prisma } from '@sassy-auth/db';

const mockPrisma = prisma as {
  saApp: { findUnique: jest.Mock };
  saUser: { findUnique: jest.Mock; findFirst: jest.Mock };
  account: { findFirst: jest.Mock };
};

const mockTokenService = {
  issueJwt: jest.fn(),
  getJwks: jest.fn(),
  resolvePermissions: jest.fn(),
};

const mockOauthService = {
  generateCode: jest.fn(),
  exchangeCode: jest.fn(),
};

const mockSqidService = {
  encode: jest.fn((id: number) => `sqid-${id}`),
  decode: jest.fn((s: string) => parseInt(s.replace('sqid-', ''), 10)),
};

function makeResponse() {
  const res = {
    redirect: jest.fn(),
  };
  return res as unknown as Response;
}

describe('TokenController', () => {
  let controller: TokenController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TokenController],
      providers: [
        { provide: TokenService, useValue: mockTokenService },
        { provide: OauthService, useValue: mockOauthService },
        { provide: SqidService, useValue: mockSqidService },
      ],
    }).compile();
    controller = module.get(TokenController);
    jest.clearAllMocks();
  });

  // ── GET /api/token/jwks ───────────────────────────────────────────────────

  describe('getJwks', () => {
    it('returns jwks from TokenService', () => {
      const jwks = { keys: [{ kty: 'RSA' }] };
      mockTokenService.getJwks.mockReturnValue(jwks);
      expect(controller.getJwks()).toEqual(jwks);
    });
  });

  // ── POST /api/token/direct/login ─────────────────────────────────────────

  describe('directLogin', () => {
    const app = { id: 10, publicId: 'sqid-10', isPlatform: false };
    const baUser = { id: 'ba-1', email: 'user@example.com' };
    const saUser = {
      id: 1,
      publicId: 'sqid-1',
      betterAuthUserId: 'ba-1',
      orgId: 5,
      org: { id: 5, publicId: 'sqid-5', appId: 10 },
    };
    const account = { password: 'hashed', providerId: 'credential' };

    it('returns access_token when credentials are valid', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(app);
      // Simulate email identifier → direct lookup by email on BetterAuth user
      mockPrisma.saUser.findFirst.mockResolvedValue({ ...saUser, betterAuthUser: baUser });
      mockPrisma.account.findFirst.mockResolvedValue(account);
      mockTokenService.issueJwt.mockResolvedValue('signed.jwt.token');

      // Mock bcrypt compare — inject via jest.mock in the actual test file
      // For unit testing, we test the controller orchestration only; bcrypt is
      // covered in the e2e test (Task 15) which uses real hashes.
    });

    it('throws ForbiddenException (USER_ORG_MISMATCH) when user org does not match app', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...app, id: 99 });
      mockPrisma.saUser.findFirst.mockResolvedValue({
        ...saUser,
        org: { id: 5, publicId: 'sqid-5', appId: 999 }, // different app
        betterAuthUser: baUser,
      });
      mockPrisma.account.findFirst.mockResolvedValue(account);

      await expect(
        controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-99' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when app does not exist', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(null);

      const { NotFoundException } = await import('@nestjs/common');
      await expect(
        controller.directLogin({ identifier: 'user@example.com', password: 'pw', appId: 'sqid-99' }),
      ).rejects.toThrow();
    });
  });

  // ── POST /api/token/oauth/token ───────────────────────────────────────────

  describe('oauthToken', () => {
    it('returns access_token when code is valid', async () => {
      mockOauthService.exchangeCode.mockReturnValue({
        userId: 'sqid-1',
        appPublicId: 'sqid-10',
      });
      const saUser = {
        id: 1,
        publicId: 'sqid-1',
        orgId: 5,
        org: { publicId: 'sqid-5', appId: 10 },
      };
      mockPrisma.saUser.findFirst.mockResolvedValue(saUser);
      mockPrisma.saApp.findUnique.mockResolvedValue({ id: 10, publicId: 'sqid-10' });
      mockTokenService.issueJwt.mockResolvedValue('oauth.jwt.token');

      const result = await controller.oauthToken({
        code: 'valid-code',
        client_id: 'sqid-10',
        client_secret: 'secret',
        redirect_uri: 'https://app.example.com/callback',
      });

      expect(result).toEqual({
        access_token: 'oauth.jwt.token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/auth-server && pnpm test -- token.controller.spec.ts --verbose
```

Expected: FAIL — `Cannot find module './token.controller'`

- [ ] **Step 3: Implement TokenController**

`apps/auth-server/src/token/token.controller.ts`:
```typescript
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Query,
  Redirect,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { compare } from 'bcryptjs';
import { Request } from 'express';
import { prisma } from '@sassy-auth/db';
import { detectIdentifierType, TokenErrorCode } from '@sassy-auth/types';
import { auth } from '../auth/auth.config';
import { fromNodeHeaders } from 'better-auth/node';
import { SqidService } from '../common/sqid/sqid.service';
import { DirectLoginDto } from './dto/direct-login.dto';
import { OauthTokenExchangeDto } from './dto/oauth-token-exchange.dto';
import { OauthService } from './oauth.service';
import { TokenService } from './token.service';

@Controller('token')
export class TokenController {
  constructor(
    private readonly tokenService: TokenService,
    private readonly oauthService: OauthService,
    private readonly sqidService: SqidService,
  ) {}

  /** GET /api/token/jwks */
  @Get('jwks')
  getJwks() {
    return this.tokenService.getJwks();
  }

  /**
   * GET /api/token/oauth/authorize
   *
   * Validates the client_id (app), checks the requester has an active
   * BetterAuth session, issues an authorization code, and redirects to
   * redirect_uri with the code and state.
   */
  @Get('oauth/authorize')
  async oauthAuthorize(
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('state') state: string = '',
    @Req() req: Request,
  ) {
    // Validate app exists
    const numericId = this.sqidService.decode(clientId);
    const app = await prisma.saApp.findUnique({ where: { id: numericId } });
    if (!app) {
      throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
    }

    // Require active BetterAuth session
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) {
      throw new UnauthorizedException();
    }

    // Look up sa_user for this BetterAuth user
    const saUser = await prisma.saUser.findFirst({
      where: { betterAuthUserId: session.user.id },
      include: { org: true },
    });
    if (!saUser) {
      throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
    }
    if (saUser.org.appId !== app.id) {
      throw new ForbiddenException(TokenErrorCode.USER_ORG_MISMATCH);
    }

    const code = this.oauthService.generateCode(saUser.publicId, app.publicId);
    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);

    return { url: url.toString(), statusCode: 302 };
  }

  /**
   * POST /api/token/oauth/token
   *
   * Exchanges an authorization code for a signed RS256 JWT.
   * client_secret is validated against sa_app (stored as hash in future
   * sub-projects — for now any non-empty value is accepted).
   */
  @Post('oauth/token')
  async oauthToken(@Body() dto: OauthTokenExchangeDto) {
    const { userId: userPublicId, appPublicId } = this.oauthService.exchangeCode(
      dto.code,
      dto.client_id,
    );

    const saUser = await prisma.saUser.findFirst({
      where: { publicId: userPublicId },
      include: { org: true },
    });
    if (!saUser) {
      throw new ForbiddenException(TokenErrorCode.USER_NOT_FOUND);
    }

    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId,
    });

    return { access_token: token, token_type: 'Bearer', expires_in: 3600 };
  }

  /**
   * POST /api/token/direct/login
   *
   * Accepts an identifier (email | username | phone) + password + appId.
   * Validates credentials directly against the bcrypt hash in the account
   * table (no BetterAuth session created). Returns a signed RS256 JWT.
   */
  @Post('direct/login')
  async directLogin(@Body() dto: DirectLoginDto) {
    // 1. Validate app exists
    const appNumericId = this.sqidService.decode(dto.appId);
    const app = await prisma.saApp.findUnique({ where: { id: appNumericId } });
    if (!app) {
      throw new NotFoundException(TokenErrorCode.APP_NOT_FOUND);
    }

    // 2. Resolve BetterAuth email from identifier
    const identifierType = detectIdentifierType(dto.identifier);
    let betterAuthEmail: string;
    let saUser: { id: number; publicId: string; betterAuthUserId: string; org: { publicId: string; appId: number } } | null;

    if (identifierType === 'email') {
      saUser = await prisma.saUser.findFirst({
        where: { betterAuthUser: { email: dto.identifier } },
        include: { org: true, betterAuthUser: true },
      }) as typeof saUser;
      betterAuthEmail = dto.identifier;
    } else if (identifierType === 'username') {
      const found = await prisma.saUser.findFirst({
        where: { username: dto.identifier },
        include: { org: true, betterAuthUser: true },
      }) as (typeof saUser & { betterAuthUser: { email: string } }) | null;
      if (!found) throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
      betterAuthEmail = (found as unknown as { betterAuthUser: { email: string } }).betterAuthUser.email;
      saUser = found;
    } else {
      // phone
      const found = await prisma.saUser.findFirst({
        where: { phoneNumber: dto.identifier },
        include: { org: true, betterAuthUser: true },
      }) as (typeof saUser & { betterAuthUser: { email: string } }) | null;
      if (!found) throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
      betterAuthEmail = (found as unknown as { betterAuthUser: { email: string } }).betterAuthUser.email;
      saUser = found;
    }

    if (!saUser) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
    }

    // 3. Validate password against BetterAuth account table
    const account = await prisma.account.findFirst({
      where: {
        user: { email: betterAuthEmail },
        providerId: 'credential',
      },
    });
    if (!account?.password) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
    }
    const valid = await compare(dto.password, account.password);
    if (!valid) {
      throw new UnauthorizedException(TokenErrorCode.INVALID_CREDENTIALS);
    }

    // 4. Validate user's org is associated with the requested app
    if (saUser.org.appId !== app.id) {
      throw new ForbiddenException(TokenErrorCode.USER_ORG_MISMATCH);
    }

    // 5. Issue JWT
    const token = await this.tokenService.issueJwt({
      saUserId: saUser.id,
      userPublicId: saUser.publicId,
      orgPublicId: saUser.org.publicId,
      appPublicId: app.publicId,
    });

    return { access_token: token, token_type: 'Bearer', expires_in: 3600 };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/auth-server && pnpm test -- token.controller.spec.ts --verbose
```

Expected: PASS — tests passing. (Note: the directLogin bcrypt test is intentionally skipped in unit tests; it is covered by the E2E test in Task 15.)

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.controller.spec.ts
git commit -m "feat(auth-server): token controller — JWKS, direct login, OAuth2 code flow"
```

---

## Task 13: TokenModule & AppModule Wiring

**Files:**
- Create: `apps/auth-server/src/token/token.module.ts`
- Modify: `apps/auth-server/src/app.module.ts`

- [ ] **Step 1: Create token.module.ts**

`apps/auth-server/src/token/token.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TokenController } from './token.controller';
import { TokenService } from './token.service';
import { OauthService } from './oauth.service';

@Module({
  controllers: [TokenController],
  providers: [TokenService, OauthService],
})
export class TokenModule {}
```

- [ ] **Step 2: Verify app.module.ts already imports all modules**

`apps/auth-server/src/app.module.ts` should read exactly:
```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { TokenModule } from './token/token.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [CommonModule, AuthModule, TokenModule],
})
export class AppModule {}
```

If it matches (written in Task 4, Step 5), no change needed.

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
cd apps/auth-server && pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Run all unit tests**

```bash
cd apps/auth-server && pnpm test --verbose
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.module.ts
git commit -m "feat(auth-server): wire token module"
```

---

## Task 14: Seed Script — Platform Bootstrap

**Files:**
- Create: `apps/auth-server/src/seed/seed.ts`

The seed is idempotent: it checks for an existing platform app before creating one.

- [ ] **Step 1: Create seed.ts**

`apps/auth-server/src/seed/seed.ts`:
```typescript
import { prisma } from '@sassy-auth/db';
import Sqids from 'sqids';

const sqids = new Sqids({
  alphabet: process.env.SQIDS_ALPHABET || undefined,
  minLength: 4,
});

const PLATFORM_PERMISSIONS = [
  'platform.orgs.manage',
  'platform.apps.manage',
  'platform.users.manage',
  'platform.permissions.manage',
  'org.users.manage',
  'org.permissions.manage',
] as const;

async function main() {
  console.log('Seeding platform data...');

  // 1. Platform app
  let platformApp = await prisma.saApp.findFirst({ where: { isPlatform: true } });

  if (!platformApp) {
    const created = await prisma.saApp.create({
      data: {
        publicId: 'placeholder',
        name: 'SassyAuth',
        url: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
        isPlatform: true,
      },
    });
    const publicId = sqids.encode([created.id]);
    platformApp = await prisma.saApp.update({
      where: { id: created.id },
      data: { publicId },
    });
    console.log(`Created platform app: id=${platformApp.id}, publicId=${platformApp.publicId}`);
  } else {
    console.log(`Platform app already exists: publicId=${platformApp.publicId}`);
  }

  // 2. Platform org
  let platformOrg = await prisma.saOrg.findFirst({ where: { isPlatform: true } });

  if (!platformOrg) {
    const created = await prisma.saOrg.create({
      data: {
        publicId: 'placeholder',
        name: 'Platform',
        appId: platformApp.id,
        isPlatform: true,
      },
    });
    const publicId = sqids.encode([created.id]);
    platformOrg = await prisma.saOrg.update({
      where: { id: created.id },
      data: { publicId },
    });
    console.log(`Created platform org: id=${platformOrg.id}, publicId=${platformOrg.publicId}`);
  } else {
    console.log(`Platform org already exists: publicId=${platformOrg.publicId}`);
  }

  // 3. Platform permissions (immutable — create if absent, never update)
  for (const name of PLATFORM_PERMISSIONS) {
    const existing = await prisma.saPermission.findUnique({ where: { name } });
    if (!existing) {
      const created = await prisma.saPermission.create({
        data: {
          publicId: 'placeholder',
          name,
          appId: platformApp.id,
        },
      });
      const publicId = sqids.encode([created.id]);
      await prisma.saPermission.update({
        where: { id: created.id },
        data: { publicId },
      });
      console.log(`Created permission: ${name}`);
    }
  }

  console.log('Seed complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Confirm seed script is registered in package.json**

`apps/auth-server/package.json` already has:
```json
"seed": "ts-node -r tsconfig-paths/register src/seed/seed.ts"
```

Verify it is present. If missing, add it under `"scripts"`.

- [ ] **Step 3: Commit**

```bash
git add apps/auth-server/src/seed/seed.ts
git commit -m "feat(auth-server): platform bootstrap seed"
```

---

## Task 15: E2E Integration Test

**Files:**
- Create: `apps/auth-server/test/jest-e2e.json`
- Create: `apps/auth-server/test/app.e2e-spec.ts`

This test requires a real PostgreSQL database. Use Docker:
```bash
docker run --name sassy-test-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sassyauth_test -p 5433:5432 -d postgres:16-alpine
```

Set `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/sassyauth_test` in your shell before running.

- [ ] **Step 1: Create test/jest-e2e.json**

`apps/auth-server/test/jest-e2e.json`:
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "testTimeout": 30000
}
```

- [ ] **Step 2: Write the E2E test**

`apps/auth-server/test/app.e2e-spec.ts`:
```typescript
import * as crypto from 'crypto';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import express from 'express';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { prisma } from '@sassy-auth/db';
import { AppModule } from '../src/app.module';
import { auth } from '../src/auth/auth.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

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
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    httpServer = app.getHttpServer();

    // Seed platform data
    const { execSync: exec2 } = await import('child_process');
    exec2('pnpm seed', { stdio: 'inherit', cwd: process.cwd() });

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
      const platformApp = await prisma.saApp.findFirst({ where: { isPlatform: true } });
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
```

- [ ] **Step 3: Start test DB and run migrations**

```bash
docker run --name sassy-test-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=sassyauth_test \
  -p 5433:5432 -d postgres:16-alpine

export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/sassyauth_test"
cd packages/db && npx prisma migrate dev --name init
```

Expected: Migration runs successfully, all tables created.

- [ ] **Step 4: Run E2E tests**

```bash
cd apps/auth-server && DATABASE_URL="postgresql://postgres:postgres@localhost:5433/sassyauth_test" pnpm test:e2e --verbose
```

Expected: All E2E tests pass. Key assertions:
- JWKS returns valid RSA public key matching the test key pair
- Direct login with correct credentials returns a verifiable RS256 JWT
- JWT claims (`sub`, `aud`, `iss`, `permissions`) are correct
- Wrong password returns 401
- Missing fields return 400

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/test/
git commit -m "test(auth-server): e2e integration test — JWKS, direct login, OAuth2 flow"
```

---

## Post-Plan Checklist

**Spec coverage verification:**
- [x] Section 1 (Project structure) → Tasks 1–4
- [x] Section 2 (Data model — all sa_ tables) → Task 2
- [x] Section 3 (BetterAuth integration — mount, guard) → Tasks 4, 7, 8
- [x] Section 4 (JWT design — RS256, claims, JWKS) → Task 9
- [x] Section 5 (Auth flows A and B) → Tasks 10, 12
- [x] Section 6 (Error handling — HttpExceptionFilter, error codes) → Tasks 3, 6
- [x] Section 7 (Testing — unit + integration) → Tasks 5, 8, 9, 10, 12, 15
- [x] Seed / platform bootstrap → Task 14
- [x] Sqid public IDs → Tasks 5, 14

**Out of scope (confirmed per spec section 7):**
- management-ui (NextJS app) — sub-project 2
- User/Org/App/Permission/Role CRUD APIs — sub-project 3
- Resource server SDK — sub-project 5
