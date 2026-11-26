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
// bug (found live from GCP Cloud Run prod logs after the Render cutover):
// the hop count was hardcoded to `1`, correct for Render's single internal
// hop but stale once `gcp-deployment.md`'s external HTTPS Load Balancer
// (serverless NEG) was added in front of Cloud Run — a second hop. `req.ip`
// resolved to the load balancer's own address for every caller, collapsing
// every distinct user's traffic onto one shared rate-limit bucket and
// producing 429s (e.g. `GET /api/token/oauth/authorize`) uncorrelated with
// any individual client's request rate. Fix: read the hop count from
// `TRUST_PROXY_HOPS` (default `1`, matching Render) instead of hardcoding it,
// so `gcp/env.auth-server.yaml` can set `2` for the GCP topology while Render
// keeps today's behaviour unchanged.
//
// This spec can't drive `bootstrap()` itself (requires a live Postgres
// connection via AppModule -> PrismaService — see main-body-parser.spec.ts's
// note on the same limitation), so it isolates the exact mechanism the fix
// relies on: `app.set('trust proxy', N)` making `req.ips` (and `req.ip`)
// reflect the real client behind N proxy hops, the same way
// main-body-parser.spec.ts isolates the body-parser fix.
describe('main.ts trust proxy setting', () => {
  const clientIp = '203.0.113.7';
  const lbIp = '198.51.100.9';

  function buildApp(trustProxyHops: number) {
    const app = express();
    if (trustProxyHops > 0) {
      app.set('trust proxy', trustProxyHops);
    }
    app.get('/whoami', (req, res) => {
      res.status(200).json({ ip: req.ip, ips: req.ips });
    });
    return app;
  }

  it('ignores X-Forwarded-For without trust proxy set — reproduces the original bug', async () => {
    const app = buildApp(0);
    const res = await request(app).get('/whoami').set('X-Forwarded-For', clientIp);
    expect(res.body.ips).toEqual([]);
    expect(res.body.ip).not.toBe(clientIp);
  });

  it('resolves the real client from X-Forwarded-For with one trusted hop (Render)', async () => {
    const app = buildApp(1);
    const res = await request(app).get('/whoami').set('X-Forwarded-For', clientIp);
    expect(res.body.ips).toEqual([clientIp]);
    expect(res.body.ip).toBe(clientIp);
  });

  it('with only one hop trusted, a second untrusted hop (the GCP LB) is misread as the client — reproduces the GCP cutover bug', async () => {
    const app = buildApp(1);
    const res = await request(app).get('/whoami').set('X-Forwarded-For', `${clientIp}, ${lbIp}`);
    expect(res.body.ip).toBe(lbIp);
    expect(res.body.ip).not.toBe(clientIp);
  });

  it('resolves the real client through two trusted hops (GCP LB + Cloud Run ingress) — the fix', async () => {
    const app = buildApp(2);
    const res = await request(app).get('/whoami').set('X-Forwarded-For', `${clientIp}, ${lbIp}`);
    expect(res.body.ips).toEqual([clientIp, lbIp]);
    expect(res.body.ip).toBe(clientIp);
  });

  it('still falls back to the socket address when no X-Forwarded-For header is present', async () => {
    const app = buildApp(1);
    const res = await request(app).get('/whoami');
    expect(res.body.ips).toEqual([]);
    expect(typeof res.body.ip).toBe('string');
    expect(res.body.ip.length).toBeGreaterThan(0);
  });
});
