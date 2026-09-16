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
import { DEFAULT_THROTTLE, AUTH_THROTTLE } from './common/config/rate-limit-config';

// bug-0080: Two throttler buckets — a generous `default` for the
// general API surface and a tight `auth` bucket for endpoints where
// brute-forcing a credential is the risk (direct login, invitation
// validation, invitation accept). `@Throttle({ auth: AUTH_THROTTLE })` on
// those handlers narrows the limit; everything else falls back to
// `default`. In `test` mode both buckets are effectively disabled so
// e2e runs (which hammer the same endpoints repeatedly) don't trip
// the limiter.
//
// bug-0278: DEFAULT_THROTTLE / AUTH_THROTTLE (common/config/rate-limit-config.ts)
// are the single source of truth for these numbers — every per-route
// @Throttle() override below imports the same constants instead of
// re-hardcoding them, so AUTH_RATE_LIMIT / AUTH_RATE_WINDOW_MS actually
// take effect everywhere the `auth` bucket is used.
const isTest = process.env.NODE_ENV === 'test';

const throttlerConfig = [
  { name: 'default', ...DEFAULT_THROTTLE },
  { name: 'auth', ...AUTH_THROTTLE },
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
