// Type declarations for @better-auth/utils sub-path imports used in tests.
// The package ships .d.ts files but doesn't expose them via package.json exports.
declare module '@better-auth/utils/otp' {
  export function createOTP(
    secret: string,
    opts?: { digits?: number; period?: number },
  ): {
    hotp: (counter: number) => Promise<string>;
    totp: () => Promise<string>;
    verify: (otp: string, options?: { window?: number }) => Promise<boolean>;
    url: (issuer: string, account: string) => string;
  };
}
