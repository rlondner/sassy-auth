import { Module } from '@nestjs/common';
import { TokenController } from './token.controller';
import { DiscoveryController } from './discovery.controller';
import { TokenService } from './token.service';
import { OauthService } from './oauth.service';

@Module({
  controllers: [TokenController, DiscoveryController],
  providers: [TokenService, OauthService],
})
export class TokenModule {}
