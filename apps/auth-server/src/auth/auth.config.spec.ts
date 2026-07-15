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
