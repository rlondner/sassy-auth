// Stub for better-auth/api — exposes the APIError class that auth.config uses.
// Mirrors better-call's real APIError shape (see
// node_modules/better-call/dist/error.mjs — InternalAPIError stores the
// second constructor arg verbatim as `this.body`) closely enough that specs
// asserting on a thrown error's `.body.code` behave the same against this
// mock as they would against the real library.
export class APIError extends Error {
  status: string;
  body?: { message?: string; code?: string; [key: string]: unknown };

  constructor(status: string, body?: { message?: string; code?: string; [key: string]: unknown }) {
    super(body?.message ?? status);
    this.name = 'APIError';
    this.status = status;
    this.body = body;
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
