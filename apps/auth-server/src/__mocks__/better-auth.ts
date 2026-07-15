// Stub for better-auth — captures betterAuth() call options so tests can
// introspect the auth config without needing a real DB or ESM-capable runner.
export const betterAuth = (options: Record<string, unknown>) => ({
  options,
  api: { getSession: jest.fn() },
  handler: jest.fn(),
});
