import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DiscoveryController } from './discovery.controller';
import {
  OAUTH_AS_METADATA_PATH,
  buildOAuthAuthorizationServerMetadata,
} from './oauth-metadata';

describe('DiscoveryController', () => {
  let app: INestApplication;
  const originalIssuer = process.env.BETTER_AUTH_URL;

  async function buildApp(issuer: string | undefined): Promise<INestApplication> {
    if (issuer === undefined) {
      delete process.env.BETTER_AUTH_URL;
    } else {
      process.env.BETTER_AUTH_URL = issuer;
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [DiscoveryController],
    }).compile();
    const instance = moduleRef.createNestApplication();
    // Mirror the production wiring in configure-nest-app.ts: the /api global
    // prefix applies to everything EXCEPT the well-known discovery doc, which
    // RFC 8414 mandates be served at the host root.
    instance.setGlobalPrefix('api', { exclude: [OAUTH_AS_METADATA_PATH] });
    await instance.init();
    return instance;
  }

  afterEach(async () => {
    if (app) await app.close();
    if (originalIssuer === undefined) {
      delete process.env.BETTER_AUTH_URL;
    } else {
      process.env.BETTER_AUTH_URL = originalIssuer;
    }
  });

  it('serves the RFC 8414 metadata at /.well-known/oauth-authorization-server (root, not /api/...)', async () => {
    app = await buildApp('http://localhost:3000');
    const res = await request(app.getHttpServer()).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(buildOAuthAuthorizationServerMetadata('http://localhost:3000'));
    expect(res.body.issuer).toBe('http://localhost:3000');
    expect(res.body.authorization_endpoint).toBe('http://localhost:3000/api/token/oauth/authorize');
    expect(res.body.token_endpoint).toBe('http://localhost:3000/api/token/oauth/token');
    expect(res.body.jwks_uri).toBe('http://localhost:3000/api/token/jwks');
  });

  it('does NOT serve the metadata under the /api prefix', async () => {
    app = await buildApp('http://localhost:3000');
    const res = await request(app.getHttpServer()).get('/api/.well-known/oauth-authorization-server');
    expect(res.status).toBe(404);
  });

  it('regenerates the doc per request — picking up a changed BETTER_AUTH_URL without a reboot', async () => {
    app = await buildApp('http://localhost:3000');
    const before = await request(app.getHttpServer()).get('/.well-known/oauth-authorization-server');
    expect(before.body.issuer).toBe('http://localhost:3000');

    // Without restarting the Nest app, change the env var the controller reads.
    process.env.BETTER_AUTH_URL = 'https://auth.prod.example.com';
    const after = await request(app.getHttpServer()).get('/.well-known/oauth-authorization-server');
    expect(after.body.issuer).toBe('https://auth.prod.example.com');
    expect(after.body.token_endpoint).toBe('https://auth.prod.example.com/api/token/oauth/token');
  });

  it('falls back to a documented placeholder issuer when BETTER_AUTH_URL is unset', async () => {
    app = await buildApp(undefined);
    const res = await request(app.getHttpServer()).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.issuer).toBe('https://auth.example.com');
  });
});
