import { Module } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';
import { RateLimitGuard, AppLookupRateLimitGuard } from './rate-limit.guard';
import { PasswordPolicyController } from '../auth/password-policy.controller';
import { TurnstileService } from './turnstile.service';
import { TokenModule } from '../token/token.module';

/**
 * SqidService and LoggerService are provided globally via CommonModule
 * so we don't need to re-import them here. TokenModule is imported for
 * OauthService, which RegistrationService uses to mint a signup-flow
 * authorization code.
 */
@Module({
  imports: [TokenModule],
  controllers: [RegistrationController, PasswordPolicyController],
  providers: [RegistrationService, RateLimitGuard, AppLookupRateLimitGuard, TurnstileService],
})
export class RegistrationModule {}
