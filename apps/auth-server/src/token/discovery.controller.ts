import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  OAUTH_AS_METADATA_PATH,
  OAuthAuthorizationServerMetadata,
  buildOAuthAuthorizationServerMetadata,
} from './oauth-metadata';

@ApiExcludeController()
@Controller()
export class DiscoveryController {
  @Get(OAUTH_AS_METADATA_PATH)
  getOAuthAuthorizationServerMetadata(): OAuthAuthorizationServerMetadata {
    const issuer = process.env.BETTER_AUTH_URL ?? 'https://auth.example.com';
    return buildOAuthAuthorizationServerMetadata(issuer);
  }
}
