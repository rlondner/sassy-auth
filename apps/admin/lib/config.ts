export const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'
export const CI_TESTS =
  process.env.CI_TESTS === 'true' ||
  process.env.CI === 'true' ||
  process.env.NODE_ENV === 'test'
