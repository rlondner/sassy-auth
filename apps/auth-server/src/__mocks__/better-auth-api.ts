// Stub for better-auth/api — exposes the APIError class that auth.config uses.
export class APIError extends Error {
  constructor(code: string, options?: { message?: string }) {
    super(options?.message ?? code);
    this.name = 'APIError';
  }
}

// task-8: real better-auth's createAuthMiddleware wraps a handler in
// framework plumbing (see @better-auth/core/api/index.mjs:29). For the
// purposes of these config-shape tests we only need auth.config.ts to
// import a callable; the identity function is sufficient since no spec
// here drives an actual request through the hook pipeline.
export function createAuthMiddleware<T extends (...args: never[]) => unknown>(handler: T): T {
  return handler;
}
