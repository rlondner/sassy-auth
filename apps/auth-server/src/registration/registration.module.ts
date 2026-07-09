import { Module } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * SqidService and LoggerService are provided globally via CommonModule
 * so we don't need to re-import them here.
 */
@Module({
  controllers: [RegistrationController],
  providers: [RegistrationService, RateLimitGuard],
})
export class RegistrationModule {}
