import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

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
