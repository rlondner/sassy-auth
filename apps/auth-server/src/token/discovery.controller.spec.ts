import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DiscoveryController } from './discovery.controller';
import {
  OAUTH_AS_METADATA_PATH,
  buildOAuthAuthorizationServerMetadata,
} from './oauth-metadata';

// This spec mutates process.env.BETTER_AUTH_URL inside test bodies. Jest runs
// tests within a single file serially by default, and beforeEach/afterEach
// below snapshot + restore the env on every test boundary so a failing test
// cannot leak its mutation to the next. If you ever switch this file to
// `test.concurrent` or move BETTER_AUTH_URL reads to module-init time, this
// isolation breaks — keep the env reads request-scoped.
describe('DiscoveryController', () => {
  let app: INestApplication;
  let originalIssuer: string | undefined;
  let warnSpy: jest.SpyInstance;

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

  beforeEach(() => {
    originalIssuer = process.env.BETTER_AUTH_URL;
    // Controller logs a startup warning when BETTER_AUTH_URL is unset; mute it
    // here so the "falls back to placeholder" test doesn't pollute output.
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (app) await app.close();
    if (originalIssuer === undefined) {
      delete process.env.BETTER_AUTH_URL;
    } else {
      process.env.BETTER_AUTH_URL = originalIssuer;
    }
    warnSpy.mockRestore();
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

  it('logs a startup warning when BETTER_AUTH_URL is unset so a misconfigured prod deploy is observable', async () => {
    app = await buildApp(undefined);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('BETTER_AUTH_URL is unset'),
    );
  });

  it('does NOT warn when BETTER_AUTH_URL is set', async () => {
    app = await buildApp('http://localhost:3000');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
