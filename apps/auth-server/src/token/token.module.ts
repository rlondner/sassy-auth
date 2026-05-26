import { Module } from '@nestjs/common';
import { TokenController } from './token.controller';
import { TokenService } from './token.service';
import { OauthService } from './oauth.service';

@Module({
  controllers: [TokenController],
  providers: [TokenService, OauthService],
})
export class TokenModule {}
