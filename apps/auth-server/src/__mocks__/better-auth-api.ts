// Stub for better-auth/api — exposes the APIError class that auth.config uses.
export class APIError extends Error {
  constructor(code: string, options?: { message?: string }) {
    super(options?.message ?? code);
    this.name = 'APIError';
  }
}
