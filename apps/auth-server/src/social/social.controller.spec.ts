import { ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
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

// Mocked, per apps.service.spec.ts's convention, so the authenticated
// authorization tests below (caller has a session but lacks
// 'platform.apps.manage') don't need a real database: checkPermission's
// real implementation always hits the `prisma` singleton.
jest.mock('../common/permissions/check-permission', () => ({
  checkPermission: jest.fn(),
}));
import { checkPermission } from '../common/permissions/check-permission';

const mockGetSession = auth.api.getSession as unknown as jest.Mock;
const mockCheckPermission = checkPermission as jest.Mock;

const authedSession = { user: { id: 'ba-caller' }, session: {} };

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

// This proves the security properties the task brief cares about for both
// authenticated routes (PUT :clientId and GET :clientId/settings): they
// reject an anonymous caller (401), they reject an authenticated caller
// lacking 'platform.apps.manage' (the checkPermission call itself throws,
// per checkPermission's real ForbiddenException contract — see
// check-permission.ts), and they call checkPermission with exactly that
// permission string (mirroring apps.service.spec.ts's assertions on
// checkPermission's arguments). Both routes boot the SocialController with
// the REAL BetterAuthGuard (only `auth.api.getSession` is mocked) so the
// guard actually runs, rather than stubbing the guard away as
// AppsController's/MeController's unit specs do when they only care about
// forwarding.
describe('SocialController authenticated routes (authentication + authorization)', () => {
  let app: INestApplication;
  let setForApp: jest.Mock;
  let listForApp: jest.Mock;
  let getSettingsForApp: jest.Mock;

  async function buildApp(): Promise<INestApplication> {
    setForApp = jest.fn().mockResolvedValue(undefined);
    listForApp = jest.fn().mockResolvedValue(['google']);
    getSettingsForApp = jest.fn().mockResolvedValue({ available: ['google', 'microsoft'], enabled: ['google'] });
    const moduleRef = await Test.createTestingModule({
      controllers: [SocialController],
      providers: [{ provide: SocialService, useValue: { listForApp, setForApp, getSettingsForApp } }],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api');
    // Matches configure-nest-app.ts's real ValidationPipe options — needed
    // so the "malformed body" test below exercises the same DTO validation
    // a real request would hit, not the test harness's default (no) pipe.
    instance.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await instance.init();
    return instance;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('PUT /api/social-providers/:clientId', () => {
    it('rejects an anonymous PUT with 401, never reaching checkPermission or the service', async () => {
      mockGetSession.mockResolvedValue(null);
      app = await buildApp();
      const res = await request(app.getHttpServer())
        .put('/api/social-providers/qp31')
        .send({ providers: ['google'] });
      expect(res.status).toBe(401);
      expect(mockCheckPermission).not.toHaveBeenCalled();
      expect(setForApp).not.toHaveBeenCalled();
    });

    it('rejects an authenticated caller lacking platform.apps.manage, never reaching the service', async () => {
      mockGetSession.mockResolvedValue(authedSession);
      mockCheckPermission.mockRejectedValue(new ForbiddenException());
      app = await buildApp();
      const res = await request(app.getHttpServer())
        .put('/api/social-providers/qp31')
        .send({ providers: ['google'] });
      expect(res.status).toBe(403);
      expect(setForApp).not.toHaveBeenCalled();
    });

    it('calls checkPermission with the caller id and platform.apps.manage', async () => {
      mockGetSession.mockResolvedValue(authedSession);
      mockCheckPermission.mockResolvedValue(undefined);
      app = await buildApp();
      const res = await request(app.getHttpServer())
        .put('/api/social-providers/qp31')
        .send({ providers: ['google'] });
      expect(res.status).toBe(200);
      expect(mockCheckPermission).toHaveBeenCalledWith('ba-caller', 'platform.apps.manage');
      expect(setForApp).toHaveBeenCalledWith('qp31', ['google']);
    });

    it('rejects a malformed body (non-string providers entries) with 400', async () => {
      mockGetSession.mockResolvedValue(authedSession);
      mockCheckPermission.mockResolvedValue(undefined);
      app = await buildApp();
      const res = await request(app.getHttpServer())
        .put('/api/social-providers/qp31')
        .send({ providers: [42] });
      expect(res.status).toBe(400);
      expect(setForApp).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/social-providers/:clientId/settings', () => {
    it('rejects an anonymous GET with 401, never reaching checkPermission or the service', async () => {
      mockGetSession.mockResolvedValue(null);
      app = await buildApp();
      const res = await request(app.getHttpServer()).get('/api/social-providers/qp31/settings');
      expect(res.status).toBe(401);
      expect(mockCheckPermission).not.toHaveBeenCalled();
      expect(getSettingsForApp).not.toHaveBeenCalled();
    });

    it('rejects an authenticated caller lacking platform.apps.manage, never reaching the service', async () => {
      mockGetSession.mockResolvedValue(authedSession);
      mockCheckPermission.mockRejectedValue(new ForbiddenException());
      app = await buildApp();
      const res = await request(app.getHttpServer()).get('/api/social-providers/qp31/settings');
      expect(res.status).toBe(403);
      expect(getSettingsForApp).not.toHaveBeenCalled();
    });

    it('calls checkPermission with the caller id and platform.apps.manage, and returns available+enabled', async () => {
      mockGetSession.mockResolvedValue(authedSession);
      mockCheckPermission.mockResolvedValue(undefined);
      app = await buildApp();
      const res = await request(app.getHttpServer()).get('/api/social-providers/qp31/settings');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: ['google', 'microsoft'], enabled: ['google'] });
      expect(mockCheckPermission).toHaveBeenCalledWith('ba-caller', 'platform.apps.manage');
      expect(getSettingsForApp).toHaveBeenCalledWith('qp31');
    });
  });
});
