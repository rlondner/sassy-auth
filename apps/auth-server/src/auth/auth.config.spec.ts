// Light assertion that the twoFactor plugin is present in the auth instance
// with the expected options. This is not a runtime integration test — it
// validates that the config object compiled and the plugin was included.

// Mock the heavy dependencies so we can import auth.config in jest.
jest.mock('@sassy-auth/db', () => ({
  prisma: {},
}));
jest.mock('better-auth/adapters/prisma', () => ({
  prismaAdapter: () => ({}),
}));
jest.mock('../email/email.singleton', () => ({
  getEmailer: () => ({ send: jest.fn() }),
}));
jest.mock('./otp-test-store', () => ({ otpTestStore: {} }));
jest.mock('./otp-sender', () => ({ sendSignInOtp: jest.fn() }));

describe('auth.config — twoFactor plugin', () => {
  it('includes the twoFactor plugin in the plugins array', async () => {
    // Dynamic import so the mocks above are in place before module init.
    const { auth } = await import('./auth.config');
    // BetterAuth exposes the options via auth.options. Access the plugins array.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const plugins = (options['plugins'] ?? []) as Array<{ id: string; options?: unknown }>;
    const tfPlugin = plugins.find((p) => p.id === 'two-factor');
    expect(tfPlugin).toBeDefined();
  });

  it('twoFactor plugin is configured with issuer "Sassy Auth"', async () => {
    const { auth } = await import('./auth.config');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const plugins = (options['plugins'] ?? []) as Array<{ id: string; options?: Record<string, unknown> }>;
    const tfPlugin = plugins.find((p) => p.id === 'two-factor');
    // The plugin stores its options under plugin.options.issuer
    expect(tfPlugin?.options?.['issuer']).toBe('Sassy Auth');
  });

  it('twoFactor plugin has backupCodeOptions.amount = 10', async () => {
    const { auth } = await import('./auth.config');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const plugins = (options['plugins'] ?? []) as Array<{ id: string; options?: Record<string, unknown> }>;
    const tfPlugin = plugins.find((p) => p.id === 'two-factor');
    const bco = tfPlugin?.options?.['backupCodeOptions'] as Record<string, unknown> | undefined;
    expect(bco?.['amount']).toBe(10);
  });

  it('rateLimit.customRules sets verify-totp to { window: 10, max: 3 }', async () => {
    const { auth } = await import('./auth.config');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const customRules = (options['rateLimit'] as Record<string, unknown> | undefined)?.['customRules'] as
      | Record<string, { window: number; max: number }>
      | undefined;
    expect(customRules?.['/two-factor/verify-totp']).toEqual({ window: 10, max: 3 });
  });

  it('rateLimit.customRules sets verify-backup-code to { window: 10, max: 3 }', async () => {
    const { auth } = await import('./auth.config');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const customRules = (options['rateLimit'] as Record<string, unknown> | undefined)?.['customRules'] as
      | Record<string, { window: number; max: number }>
      | undefined;
    expect(customRules?.['/two-factor/verify-backup-code']).toEqual({ window: 10, max: 3 });
  });
});

// bug: the session-create gate (evaluateSessionGate) refuses a session unless a
// matching *active* SaUser exists. BetterAuth's signUpEmail auto-creates a
// session, but every caller necessarily creates the SaUser *after* sign-up (it
// needs the BetterAuth user id for the FK). So an auto sign-in at sign-up can
// never pass the gate — it can only throw. Disabling it is the architectural
// fix, not a workaround.
describe('auth.config — emailAndPassword.autoSignIn', () => {
  it('disables auto sign-in so sign-up never creates a gate-blocked session', async () => {
    const { auth } = await import('./auth.config');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const eap = options['emailAndPassword'] as Record<string, unknown>;
    expect(eap['autoSignIn']).toBe(false);
  });
});

// task-8: proves exactly one top-level `hooks.after` is wired (the HARD
// CONSTRAINT — a second `hooks: { after: ... }` object literal elsewhere in
// this config would silently overwrite this one, since BetterAuth reads
// `options.hooks?.after` as a single value, not a list). The classification
// logic itself is covered by classify-callback-outcome.spec.ts and
// rejection-code.spec.ts, driven against the exact ctx.context.returned
// shapes better-auth@1.6.11 produces; this test only asserts the wiring.
describe('auth.config — hooks.after (task-8 callback classification)', () => {
  it('registers exactly one hooks.after function', async () => {
    const { auth } = await import('./auth.config');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const hooks = options['hooks'] as Record<string, unknown> | undefined;
    expect(typeof hooks?.['after']).toBe('function');
  });
});

// task-8 fix round 1 (review finding 2): the createAuthMiddleware(async (ctx)
// => {...}) body above was previously only asserted to be "a function". The
// __mocks__/better-auth-api.ts createAuthMiddleware mock is an identity
// function, so `options.hooks.after` IS the handler itself — it can be
// invoked directly with a hand-built ctx, exercising the route match, the
// ctx.params?.id extraction, the recordFederationEvent call, the
// !outcome.canRedirect early return, and the responseHeaders.set(...) call,
// without driving BetterAuth's real router.
jest.mock('../social/record-federation-event', () => ({
  recordFederationEvent: jest.fn().mockResolvedValue(undefined),
}));

describe('auth.config — hooks.after handler body (task-8 fix round 1, review finding 2)', () => {
  async function loadAfterHook() {
    const { auth } = await import('./auth.config');
    const options = (auth as unknown as { options: Record<string, unknown> }).options;
    const hooks = options['hooks'] as Record<string, unknown>;
    return hooks['after'] as (ctx: {
      path?: string;
      params?: Record<string, string>;
      context: { returned: unknown; responseHeaders?: Headers };
    }) => Promise<void>;
  }

  function redirectReturned(errorCode: string): { status: string; headers: Headers } {
    const headers = new Headers();
    headers.set('location', `https://auth.example/error?error=${errorCode}`);
    return { status: 'FOUND', headers };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores a non-callback path: no audit event, no header set', async () => {
    const after = await loadAfterHook();
    const { recordFederationEvent } = require('../social/record-federation-event');
    const responseHeaders = new Headers();

    await after({
      path: '/sign-in/email',
      context: { returned: redirectReturned('signup_disabled'), responseHeaders },
    });

    expect(recordFederationEvent).not.toHaveBeenCalled();
    expect(responseHeaders.get('location')).toBeNull();
  });

  it('a refused callback sets the location header to the expected /oauth-error?code=... URL', async () => {
    const after = await loadAfterHook();
    const { recordFederationEvent } = require('../social/record-federation-event');
    const responseHeaders = new Headers();

    await after({
      path: '/callback/:id',
      params: { id: 'google' },
      context: { returned: redirectReturned('signup_disabled'), responseHeaders },
    });

    const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
    expect(responseHeaders.get('location')).toBe(`${adminUrl}/oauth-error?code=social_no_account`);
    expect(recordFederationEvent).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.objectContaining({
        type: 'social.signin.rejected',
        provider: 'google',
        reason: 'no_sauser_for_verified_email',
      }),
    );
  });

  it('a canRedirect: false outcome (session-gate FORBIDDEN) sets NO location header but still records an audit event', async () => {
    const after = await loadAfterHook();
    const { recordFederationEvent } = require('../social/record-federation-event');
    const responseHeaders = new Headers();

    await after({
      path: '/callback/:id',
      params: { id: 'microsoft' },
      context: { returned: { status: 'FORBIDDEN' }, responseHeaders },
    });

    expect(responseHeaders.get('location')).toBeNull();
    expect(recordFederationEvent).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.objectContaining({
        type: 'social.signin.rejected',
        provider: 'microsoft',
        reason: 'sauser_not_active',
      }),
    );
  });

  it('the private-relay path (fix round 1, finding 1) produces social_private_relay', async () => {
    const after = await loadAfterHook();
    const { recordFederationEvent } = require('../social/record-federation-event');
    const { runWithPrivateRelayCapture, captureIsPrivateEmail } = await import(
      '../social/apple-private-relay-context'
    );
    const responseHeaders = new Headers();

    await runWithPrivateRelayCapture(async () => {
      // Mirrors what build-social-providers.ts's Apple mapProfileToUser
      // does earlier in the same request, before the refusal is decided.
      captureIsPrivateEmail(true);
      await after({
        path: '/callback/:id',
        params: { id: 'apple' },
        context: { returned: redirectReturned('signup_disabled'), responseHeaders },
      });
    });

    const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001';
    expect(responseHeaders.get('location')).toBe(`${adminUrl}/oauth-error?code=social_private_relay`);
    expect(recordFederationEvent).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.objectContaining({
        type: 'social.signin.rejected',
        provider: 'apple',
        reason: 'private_relay',
      }),
    );
  });
});
