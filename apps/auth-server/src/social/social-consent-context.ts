import { AsyncLocalStorage } from 'node:async_hooks';

interface SocialConsentStore {
  ip: string;
  userId: string | null;
}

const storage = new AsyncLocalStorage<SocialConsentStore>();

/**
 * Hands the client IP resolved at request start (main.ts, where the raw
 * Express req is still available) forward to auth.config.ts's `/callback/:id`
 * `hooks.after` matcher, and lets `databaseHooks.session.create.after` (which
 * already runs for every social sign-in and already receives the newly
 * created session's userId) hand that userId forward too — two separate
 * BetterAuth-invoked callbacks within the same request, neither of which can
 * pass a return value to the other directly. Mirrors
 * apple-private-relay-context.ts's identical use of AsyncLocalStorage for the
 * exact same shape of problem; see that file's header comment for the full
 * rationale on why this needs to wrap the entire request in main.ts rather
 * than a single function call.
 */
export function runWithSocialConsentCapture<T>(ip: string, fn: () => T): T {
  return storage.run({ ip, userId: null }, fn);
}

/** Called from auth.config.ts's databaseHooks.session.create.after. No-op
 * outside a capture scope (e.g. a password/OTP sign-in). */
export function captureSocialSignInUserId(userId: string): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}

/** Read what this request has captured so far. Both fields are null/absent
 * outside any capture scope. */
export function readSocialConsentContext(): { ip: string | null; userId: string | null } {
  const store = storage.getStore();
  return { ip: store?.ip ?? null, userId: store?.userId ?? null };
}
