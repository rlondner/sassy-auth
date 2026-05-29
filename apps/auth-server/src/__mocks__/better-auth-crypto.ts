// Stub for better-auth/crypto — used by Jest unit tests to avoid ESM parse
// errors when ts-jest tries to load the real .mjs distribution.
export const verifyPassword = async (_: { hash: string; password: string }) => true;
export const hashPassword = async (_password: string) => 'stub-hash';
