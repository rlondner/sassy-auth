import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

// Mocked so the PUT-rejects-anonymous-callers test below can exercise the
// real BetterAuthGuard without a database: the guard calls
// `auth.api.getSession`, which we control per-test.
jest.mock('../auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));
import { auth } from '../auth/auth.config';

const mockGetSession = auth.api.getSession as unknown as jest.Mock;

// This is the check the task brief asks for: prove the route answers without
// a session and without 404ing an unknown client_id. It mirrors
// discovery.controller.spec.ts's pattern (Nest testing module + supertest +
// the same setGlobalPrefix('api') used in configure-nest-app.ts) instead of
// booting the real server, so it needs no database and no BetterAuth guard
// wiring. No `@UseGuards` is registered anywhere in this module — guards in
// this codebase are opt-in per controller — so the absence of one here is
// sufficient for the route to be public; this test just proves it.
describe('SocialController (public reachability)', () => {
  let app: INestApplication;

  async function buildApp(listForApp: jest.Mock): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [SocialController],
      providers: [{ provide: SocialService, useValue: { listForApp } }],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api');
    await instance.init();
    return instance;
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  it('answers GET /api/social-providers with 200 and no auth', async () => {
    app = await buildApp(jest.fn().mockResolvedValue(['google']));
    const res = await request(app.getHttpServer())
      .get('/api/social-providers')
      .query({ client_id: 'qp31' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ providers: ['google'] });
  });

  it('answers 200 with an empty list for an unknown client_id — never 404', async () => {
    app = await buildApp(jest.fn().mockResolvedValue([]));
    const res = await request(app.getHttpServer())
      .get('/api/social-providers')
      .query({ client_id: 'doesnotexist' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ providers: [] });
  });

  it('sends no cookie/authorization header, proving the route needs none', async () => {
    app = await buildApp(jest.fn().mockResolvedValue([]));
    const res = await request(app.getHttpServer()).get('/api/social-providers');
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(401);
  });
});

// This proves the security property the task brief cares about: the PUT
// changes which identity providers an app trusts, so — unlike the GET above
// — it must reject an anonymous caller. It boots the SocialController with
// the REAL BetterAuthGuard (only `auth.api.getSession` is mocked, per the
// module mock above) so the guard actually runs, rather than stubbing the
// guard away as AppsController's/MeController's unit specs do when they only
// care about forwarding.
describe('SocialController PUT :clientId (authenticated reachability)', () => {
  let app: INestApplication;

  async function buildApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [SocialController],
      providers: [{ provide: SocialService, useValue: { listForApp: jest.fn(), setForApp: jest.fn() } }],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api');
    await instance.init();
    return instance;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('rejects an anonymous PUT with 401, never reaching the service', async () => {
    mockGetSession.mockResolvedValue(null);
    app = await buildApp();
    const res = await request(app.getHttpServer())
      .put('/api/social-providers/qp31')
      .send({ providers: ['google'] });
    expect(res.status).toBe(401);
  });
});
