/**
 * Skipped unless real credentials and a running resource-server-fastapi are
 * present. This is an end-to-end FUNCTIONAL/AUTH check across two live
 * services, NOT a telemetry-propagation check: it proves that a real
 * password login via `TokenController.directLogin` issues a valid JWT, and
 * that JWT is accepted (or correctly scope-rejected) by
 * resource-server-fastapi's `/api/properties` endpoint.
 *
 * It does NOT prove a trace propagates across the HTTP call, for three
 * reasons: (a) `package.json`'s `test:e2e` script sets
 * `OTEL_SDK_DISABLED=true`, which disables the exporter regardless of
 * `DD_API_KEY`; (b) this test imports `AppModule` directly rather than going
 * through `main.ts`, so `src/instrument.ts` (which calls `Sentry.init`,
 * `setupOtel()`, `setupLogging()`) never runs in this test process — no
 * tracer/meter is ever initialized here; (c) the outbound `fetch()` call to
 * resource-server-fastapi below is a bare Node `fetch` with no
 * instrumentation, so no `traceparent` header is ever sent — even with a
 * real tracer running in this process, resource-server-fastapi's span would
 * start a fresh root trace, not a child of this test's trace.
 *
 * A real telemetry-propagation check would require running auth-server via
 * its normal `main.ts` entrypoint (not this Jest harness) with
 * `OTEL_SDK_DISABLED` unset and an instrumented HTTP client; that is not
 * currently automated anywhere in this repo.
 *
 * Run manually with:
 *   DD_API_KEY=... SENTRY_DSN=... RUN_OTEL_E2E=1 RS_E2E_URL=http://localhost:8010 pnpm test:e2e -- otel-thin-slice
 */
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

const shouldRun =
  process.env.RUN_OTEL_E2E === '1' &&
  process.env.DD_API_KEY &&
  process.env.SENTRY_DSN &&
  process.env.RS_E2E_URL;
const describeOrSkip = shouldRun ? describe : describe.skip;

describeOrSkip('OTel thin slice: password login -> token issuance -> resource verify', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('issues a JWT via directLogin and gets it verified (or scope-rejected) by resource-server-fastapi', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/token/direct/login')
      .send({
        appId: process.env.E2E_APP_ID,
        identifier: process.env.E2E_ADMIN_EMAIL,
        password: process.env.E2E_ADMIN_PASSWORD,
      });

    expect(loginResponse.status).toBe(201);
    const token = loginResponse.body.access_token as string;
    expect(token).toBeDefined();

    // /api/properties is resource-server-fastapi's only protected route today
    // (apps/resource-server-fastapi/app/api/routes.py) and requires the
    // rs.properties.create scope — E2E_ADMIN_EMAIL's role must grant it, or
    // this assertion should be 403 with reason "insufficient_scope" instead
    // of 200; either response proves auth.token.verify ran and propagated.
    const verifyResponse = await fetch(`${process.env.RS_E2E_URL}/api/properties`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([200, 403]).toContain(verifyResponse.status);

    // This test only proves the functional request path (issue JWT, present
    // it to resource-server-fastapi, get a valid auth decision back)
    // completed successfully. See the file header for why it does not — and
    // is not intended to — prove telemetry propagation across the call.
  });
});
