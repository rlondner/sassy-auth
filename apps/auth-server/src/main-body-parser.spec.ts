import express from 'express';
import request from 'supertest';

// Final review Finding 1: `apps/auth-server/src/main.ts` passes a raw
// Express app to `NestFactory.create(AppModule, new ExpressAdapter(...))`
// with no `bodyParser` option, so Nest's ExpressAdapter mounts its own
// default `express.json()` — Express's default 100kb limit — ahead of any
// application code. A 250KB logo data URI (base64 is ~4/3 the raw size,
// plus the `data:image/...;base64,` prefix) needs roughly 342KB, so the
// feature's advertised cap was unreachable in practice.
//
// The fix mounts an explicit `express.json({ limit: '1mb' })` directly on
// the raw `expressApp` in main.ts's `bootstrap()`, before `NestFactory.
// create` runs, so it satisfies the request before Nest's own default
// parser gets a chance to reject it. This spec can't drive `bootstrap()`
// itself end-to-end — that requires a live Postgres connection (via
// AppModule -> PrismaService) that this sandbox does not have (verified:
// running `test/app.e2e-spec.ts` here fails with "Authentication failed
// against the database server" while trying to run migrations, before the
// Nest app is even built) — so instead this test isolates exactly the
// mechanism the fix relies on: mounting `express.json({ limit: '1mb' })`
// on a raw Express app, in the same relative position main.ts mounts it
// (after a route that must keep seeing the raw body — modeled here by a
// stand-in `/api/auth/*`-shaped route — and before the JSON-parsing route
// under test). See main.ts's `bootstrap()` for the real wiring; this spec
// should be re-verified against a live server (or the e2e suite, once a
// reachable test DB is configured) before merge, per the task's
// verification note.
describe('main.ts body-parser limit (Finding 1)', () => {
  // A ~250KB raw logo, base64-encoded with the data-URI prefix a real
  // AppLogoField upload would send — comes out to roughly 342KB, matching
  // the finding's math and comfortably over Express's 100kb default.
  const rawLogoBytes = Buffer.alloc(250 * 1024, 1);
  const logoDataUri = `data:image/png;base64,${rawLogoBytes.toString('base64')}`;

  function buildAppWithLimit(limit: string | undefined) {
    const app = express();
    // Stand-in for the untouched `/api/auth/*` route in main.ts: it must
    // keep receiving the request ahead of the JSON parser, unaffected by
    // whatever body-parsing is mounted after it.
    app.all('/api/auth/*', (req, res) => res.status(204).end());
    if (limit) {
      app.use(express.json({ limit }));
    } else {
      // The bug being fixed: Nest's ExpressAdapter default, with no
      // `bodyParser` option, is effectively `express.json()` at Express's
      // built-in 100kb limit.
      app.use(express.json());
    }
    app.post('/api/apps', (req, res) => {
      res.status(200).json({ logoLength: req.body?.logo?.length ?? 0 });
    });
    return app;
  }

  it('rejects a ~342KB logo payload with a bare 413 under the old default (100kb) limit — reproduces the bug', async () => {
    const app = buildAppWithLimit(undefined);
    const res = await request(app)
      .post('/api/apps')
      .set('Content-Type', 'application/json')
      .send({ name: 'Acme', logo: logoDataUri });
    expect(res.status).toBe(413);
  });

  it('accepts a ~342KB logo payload once express.json({ limit: "1mb" }) is mounted — the fix', async () => {
    const app = buildAppWithLimit('1mb');
    const res = await request(app)
      .post('/api/apps')
      .set('Content-Type', 'application/json')
      .send({ name: 'Acme', logo: logoDataUri });
    expect(res.status).toBe(200);
    expect(res.body.logoLength).toBe(logoDataUri.length);
  });

  it('still enforces the 1mb ceiling — does not make the limit unbounded', async () => {
    const app = buildAppWithLimit('1mb');
    // ~1.3MB of raw bytes, comfortably over the 1mb JSON body ceiling once
    // base64-encoded and wrapped in a JSON string.
    const oversized = Buffer.alloc(1_300_000, 2).toString('base64');
    const res = await request(app)
      .post('/api/apps')
      .set('Content-Type', 'application/json')
      .send({ name: 'Acme', logo: `data:image/png;base64,${oversized}` });
    expect(res.status).toBe(413);
  });

  it('leaves a stand-in /api/auth/* route unaffected by the JSON limit (registered ahead of it, as in main.ts)', async () => {
    const app = buildAppWithLimit('1mb');
    const res = await request(app).post('/api/auth/sign-in/social').send({ some: 'body' });
    expect(res.status).toBe(204);
  });
});
