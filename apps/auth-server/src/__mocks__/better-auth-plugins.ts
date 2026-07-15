// Stub for better-auth/plugins — returns minimal plugin objects that carry
// the original options so config tests can assert on them.
export const magicLink = (options: Record<string, unknown>) => ({ id: 'magic-link', options });
export const emailOTP = (options: Record<string, unknown>) => ({ id: 'email-otp', options });
export const openAPI = (options: Record<string, unknown>) => ({ id: 'open-api', options });
export const twoFactor = (options: Record<string, unknown>) => ({ id: 'two-factor', options });
