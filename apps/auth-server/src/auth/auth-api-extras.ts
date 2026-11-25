// better-auth 1.7's computed `auth.api` type (InferAPI, in
// @better-auth/core's types/api.d.mts) only exposes endpoints whose metadata
// declares `isAction: false` or `scope: "http"`. createVerificationOTP /
// checkVerificationOTP / verifyEmailOTP (email-otp plugin) and
// generateOpenAPISchema (openAPI plugin) declare neither — they're still
// real, callable HTTP endpoints at runtime (present in the compiled plugin
// output under better-auth@1.7.7's dist/plugins/{email-otp,open-api}), just
// excluded from that computed type. This narrow, hand-written view restores
// the exact call shapes this codebase already relies on (verified against
// the plugins' own .d.mts), without casting the whole `auth.api` surface to
// `any`.
export interface AuthApiExtras {
  createVerificationOTP(args: {
    body: { email: string; type: 'sign-in' | 'change-email' | 'email-verification' | 'forget-password' };
  }): Promise<string>;
  checkVerificationOTP(args: {
    body: {
      email: string;
      type: 'sign-in' | 'change-email' | 'email-verification' | 'forget-password';
      otp: string;
    };
  }): Promise<{ success: boolean }>;
  verifyEmailOTP(args: {
    body: { email: string; otp: string };
  }): Promise<{ status: boolean; token: string; user: { id: string } & Record<string, unknown> }>;
  // Cast away immediately at every call site (`as unknown as OpenAPIObject`)
  // to reconcile with NestJS's OpenAPIObject shape — see bug-0092's comment
  // in main.ts — so the precise return shape here doesn't matter.
  generateOpenAPISchema(): Promise<unknown>;
}
