import { classifyRejection } from './rejection-code';

/**
 * Reads BetterAuth's OWN /callback/:id outcome and maps it onto our audit
 * reason + user-facing code. This does NOT call `classifyRejection` with a
 * real provider profile — by the time the `after` hook runs, `userInfo`
 * (`emailVerified` in particular) has already been discarded. See
 * task-8-report.md for the full file:line evidence trail; the short
 * version:
 *
 * - `better-auth@1.6.11/dist/oauth2/link-account.mjs:73-78` — when no
 *   existing BetterAuth `user` row matches the incoming identity and
 *   `disableSignUp` is true, `handleOAuthUserInfo` returns
 *   `{ error: "signup disabled" }` WITHOUT ever looking at
 *   `userInfo.emailVerified`. An unverified-email stranger and a verified
 *   but uninvited one are indistinguishable at this point — both must
 *   collapse to the generic code anyway per the design's
 *   enumeration-resistance stance, so this loses us nothing.
 * - `link-account.mjs:16-28` — when an existing BetterAuth `user` row DOES
 *   match by email but isn't linked to this provider yet, and either the
 *   provider is untrusted with an unverified email, OR the existing local
 *   account's own email isn't verified, `handleOAuthUserInfo` returns
 *   `{ error: "account not linked" }`. This is the one BetterAuth-native
 *   signal that reliably correlates with "provider email unverified" in
 *   practice (we never set `trustedProviders`, `accountLinking.enabled`
 *   stays default-true, `disableImplicitLinking` is never set) — though it
 *   can also fire on the second, unrelated condition (local account itself
 *   unverified), which this mapping cannot tell apart from the first.
 * - `better-auth@1.6.11/dist/api/routes/callback.mjs:160-163` — either
 *   `error` string is turned into a query param via
 *   `result.error.split(" ").join("_")` and the request is redirected
 *   (`redirectOnError`, itself `c.redirect(...)`, an APIError with
 *   `status: 'FOUND'` and a `location` header) to
 *   `<errorURL>?error=<code>[&error_description=...]`.
 * - Apple's `is_private_email` is never read by BetterAuth's own decision
 *   logic anywhere in this file either, so no BetterAuth-native error
 *   string encodes it. task-8 fix round 1 (review finding 1) closes this
 *   gap through a SEPARATE channel, not `returned`: Apple's provider config
 *   (build-social-providers.ts) captures `is_private_email` via
 *   `mapProfileToUser` into request-scoped AsyncLocalStorage
 *   (apple-private-relay-context.ts) before the refusal is even decided,
 *   and the caller of this function (auth.config.ts's hooks.after) passes
 *   the captured value in as `isPrivateEmail` below.
 *
 * `canRedirect` reflects a SEPARATE, load-bearing finding: `to-auth-
 * endpoints.mjs`'s final response is built via
 * `toResponse(result.response, { headers: result.headers, status:
 * result.status })` (to-auth-endpoints.mjs:172-174), and `result.status` is
 * captured ONCE, at the endpoint's original throw
 * (to-auth-endpoints.mjs:140, `status: e.statusCode`) — it is never
 * reassigned after an `after` hook runs. Rewriting `result.headers` (which
 * IS the same object as `ctx.context.responseHeaders`, confirmed at
 * to-auth-endpoints.mjs:148) changes the `location` a browser is told to
 * follow, but only takes effect when the original response was ALREADY a
 * redirect (`status: 'FOUND'`, as both `signup_disabled` and
 * `account_not_linked` are). It does nothing for a `'FORBIDDEN'` (403)
 * response — such as the session-gate's own throw in session-gate.ts, for a
 * matched-but-inactive SaUser — because the status code cannot be changed
 * from an `after` hook. `canRedirect: false` in that case tells the caller
 * not to bother mutating headers that can't change what the browser does.
 */
export interface CallbackOutcome {
  reason: string;
  code: string;
  canRedirect: boolean;
}

const BETTER_AUTH_ERROR_TO_INPUT: Record<string, { matchedUser: boolean; emailVerified: boolean }> = {
  signup_disabled: { matchedUser: false, emailVerified: true },
  account_not_linked: { matchedUser: true, emailVerified: false },
};

interface ReturnedLike {
  status?: unknown;
  headers?: { get?: (key: string) => string | null };
}

/**
 * `returned` is `ctx.context.returned` on the /callback/:id after-hook: the
 * value the endpoint itself threw or resolved with (see
 * to-auth-endpoints.mjs:100-145 for how a thrown APIError ends up there).
 * Returns null for a successful sign-in (BetterAuth's own success redirect
 * has no `error` query param) or any outcome this function does not
 * recognise — callers should leave BetterAuth's original response alone in
 * that case rather than guess.
 *
 * `isPrivateEmail` (default `false`) is the Apple `is_private_email` flag
 * captured out-of-band by apple-private-relay-context.ts — see this file's
 * header comment. It only changes the outcome for the `signup_disabled`
 * mapping (`matchedUser: false, emailVerified: true`): classifyRejection's
 * own precedence still refuses on `email_unverified` first regardless of
 * this flag, so an unverified private-relay address is unaffected.
 */
export function classifyCallbackOutcome(
  returned: unknown,
  isPrivateEmail = false,
): CallbackOutcome | null {
  if (!returned || typeof returned !== 'object') return null;
  const err = returned as ReturnedLike;

  if (err.status === 'FORBIDDEN') {
    // session-gate.ts: evaluateSessionGate found a matched SaUser that
    // isn't 'active' (or no SaUser at all, though that path normally never
    // reaches session creation for a brand-new federated identity — see
    // the signup_disabled case above). Generic by design (bullet 1).
    return { reason: 'sauser_not_active', code: 'social_no_account', canRedirect: false };
  }

  if (err.status !== 'FOUND') return null;
  const location = err.headers?.get?.('location');
  if (!location) return null;

  let betterAuthError: string | null;
  try {
    betterAuthError = new URL(location).searchParams.get('error');
  } catch {
    return null;
  }
  if (!betterAuthError) return null;

  const input = BETTER_AUTH_ERROR_TO_INPUT[betterAuthError];
  if (!input) return null;

  const classified = classifyRejection({ ...input, isPrivateEmail });
  if (!classified) return null;
  return { ...classified, canRedirect: true };
}
