import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { EmailModule } from './email/email.module';
import { TokenModule } from './token/token.module';
import { CommonModule } from './common/common.module';
import { UsersModule } from './users/users.module';
import { InvitationsModule } from './invitations/invitations.module';
import { OrgsModule } from './orgs/orgs.module';
import { RolesModule } from './roles/roles.module';
import { AppsModule } from './apps/apps.module';
import { PermissionsModule } from './permissions/permissions.module';
import { MeModule } from './me/me.module';
import { RegistrationModule } from './registration/registration.module';
import { TestSupportModule } from './test-support/test-support.module';
import { SocialModule } from './social/social.module';

// bug-0080: Two throttler buckets — a generous `default` for the
// general API surface and a tight `auth` bucket for endpoints where
// brute-forcing a credential is the risk (direct login, invitation
// validation, invitation accept). `@Throttle({ auth: { ... } })` on
// those handlers narrows the limit; everything else falls back to
// `default`. In `test` mode both buckets are effectively disabled so
// e2e runs (which hammer the same endpoints repeatedly) don't trip
// the limiter.
const isTest = process.env.NODE_ENV === 'test';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const throttlerConfig = isTest
  ? [
      { name: 'default', ttl: 60_000, limit: 10_000 },
      { name: 'auth', ttl: 60_000, limit: 10_000 },
    ]
  : [
      {
        name: 'default',
        ttl: envInt('DEFAULT_RATE_WINDOW_MS', 60_000),
        limit: envInt('DEFAULT_RATE_LIMIT', 120), // 2 req/s sustained per IP
      },
      {
        name: 'auth',
        ttl: envInt('AUTH_RATE_WINDOW_MS', 60_000),
        limit: envInt('AUTH_RATE_LIMIT', 10), // attempts/window per IP on sensitive paths
      },
    ];

@Module({
  imports: [
    SentryModule.forRoot(),
    ThrottlerModule.forRoot(throttlerConfig),
    CommonModule,
    AuthModule,
    TokenModule,
    UsersModule,
    InvitationsModule,
    OrgsModule,
    RolesModule,
    AppsModule,
    PermissionsModule,
    MeModule,
    RegistrationModule,
    EmailModule,
    SocialModule,
    ...(isTest ? [TestSupportModule] : []),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
