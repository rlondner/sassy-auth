import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  OAUTH_AS_METADATA_PATH,
  OIDC_METADATA_PATH,
  OAuthAuthorizationServerMetadata,
  OpenIdConfiguration,
  buildOAuthAuthorizationServerMetadata,
  buildOpenIdConfiguration,
  resolveIssuer,
} from './oauth-metadata';

// render.yaml's healthCheckPath is OAUTH_AS_METADATA_PATH — Render polls it
// frequently (aggressively so right after a deploy, while confirming the new
// instance is healthy). Without this, that polling — plus any other traffic
// hitting either static metadata endpoint — counts against the same global
// `default` throttle bucket as the rest of the API and can trip it, which
// makes Render see failing health checks and restart the instance,
// producing a self-inflicted restart loop instead of a stable deploy.
@SkipThrottle()
@ApiExcludeController()
@Controller()
export class DiscoveryController {
  constructor() {
    // Surface a misconfigured deploy: advertising the documented placeholder
    // (auth.example.com) is fine in dev/test but would silently mislead OAuth
    // clients in prod.
    if (!process.env.BETTER_AUTH_URL) {
      // eslint-disable-next-line no-console
      console.warn(
        '[DiscoveryController] BETTER_AUTH_URL is unset — advertising placeholder issuer in /.well-known/oauth-authorization-server and /.well-known/openid-configuration. Set BETTER_AUTH_URL to silence this warning.',
      );
    }
  }

  @Get(OAUTH_AS_METADATA_PATH)
  getOAuthAuthorizationServerMetadata(): OAuthAuthorizationServerMetadata {
    return buildOAuthAuthorizationServerMetadata(resolveIssuer());
  }

  @Get(OIDC_METADATA_PATH)
  getOpenIdConfiguration(): OpenIdConfiguration {
    return buildOpenIdConfiguration(resolveIssuer());
  }
}
