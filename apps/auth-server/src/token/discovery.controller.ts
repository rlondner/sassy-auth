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
// hitting either static metadata endpoint — counts against the throttle
// buckets registered in app.module.ts and can trip them, which makes Render
// see failing health checks and restart the instance, producing a
// self-inflicted restart loop instead of a stable deploy.
//
// Every named bucket must be listed explicitly — @SkipThrottle() with no
// args only sets { default: true } (see @nestjs/throttler's source), so it
// silently leaves any OTHER named bucket (here, `auth`, app.module.ts's
// tight 10-req/60s bucket) still active. That's exactly what happened: this
// controller was skipping `default` but still throttled by `auth`, so the
// restart loop continued even after adding a no-args @SkipThrottle() here.
@SkipThrottle({ default: true, auth: true })
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
