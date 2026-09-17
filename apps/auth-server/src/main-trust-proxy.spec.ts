import express from 'express';
import request from 'supertest';

// bug (found live from Render prod logs, 2026-09-17): sporadic 429s on
// `GET /api/social-providers`, a route the admin console polls every 5s and
// which is nowhere near the `default` bucket's 120/min/IP budget on its own.
//
// Root cause: `main.ts`'s `bootstrap()` never called
// `expressApp.set('trust proxy', ...)`. Render terminates TLS/HTTP at its
// edge and proxies to this app over one internal hop, so without that
// setting Express ignores `X-Forwarded-For` and `req.ip` resolves to the
// proxy's own address for every request. Both `@nestjs/throttler`'s default
// `ThrottlerGuard` tracker (app.module.ts) and `auth-rate-limit.ts`'s
// `clientKey` (which already documented this exact requirement — see its
// doc comment) key on `req.ip` / `req.ips`, so every visitor's traffic
// collapsed into one shared bucket instead of being metered per client.
// Combined load across every open admin-console tab then occasionally
// exceeded the shared budget, producing 429s uncorrelated with any single
// client's request rate — matching CR_2026-09-02.md finding 🟡.
//
// This spec can't drive `bootstrap()` itself (requires a live Postgres
// connection via AppModule -> PrismaService — see main-body-parser.spec.ts's
// note on the same limitation), so it isolates the exact mechanism the fix
// relies on: `app.set('trust proxy', 1)` making `req.ips` (and `req.ip`)
// reflect the real client behind one proxy hop, the same way
// main-body-parser.spec.ts isolates the body-parser fix.
describe('main.ts trust proxy setting', () => {
  const clientIp = '203.0.113.7';

  function buildApp(trustProxy: boolean) {
    const app = express();
    if (trustProxy) {
      app.set('trust proxy', 1);
    }
    app.get('/whoami', (req, res) => {
      res.status(200).json({ ip: req.ip, ips: req.ips });
    });
    return app;
  }

  it('ignores X-Forwarded-For without trust proxy set — reproduces the bug', async () => {
    const app = buildApp(false);
    const res = await request(app).get('/whoami').set('X-Forwarded-For', clientIp);
    expect(res.body.ips).toEqual([]);
    expect(res.body.ip).not.toBe(clientIp);
  });

  it('resolves the real client from X-Forwarded-For once trust proxy is set — the fix', async () => {
    const app = buildApp(true);
    const res = await request(app).get('/whoami').set('X-Forwarded-For', clientIp);
    expect(res.body.ips).toEqual([clientIp]);
    expect(res.body.ip).toBe(clientIp);
  });

  it('still falls back to the socket address when no X-Forwarded-For header is present', async () => {
    const app = buildApp(true);
    const res = await request(app).get('/whoami');
    expect(res.body.ips).toEqual([]);
    expect(typeof res.body.ip).toBe('string');
    expect(res.body.ip.length).toBeGreaterThan(0);
  });
});
