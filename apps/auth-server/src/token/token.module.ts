import { Module } from '@nestjs/common';
import { TokenController } from './token.controller';
import { DiscoveryController } from './discovery.controller';
import { TokenService } from './token.service';
import { OauthService } from './oauth.service';
import { OauthCodeCleanupService } from './oauth-code-cleanup.service';

@Module({
  controllers: [TokenController, DiscoveryController],
  // bug-0220: OauthCodeCleanupService is not injected anywhere — it is a
  // lifecycle-only provider whose OnModuleInit starts the expired-code sweep.
  providers: [TokenService, OauthService, OauthCodeCleanupService],
})
export class TokenModule {}
