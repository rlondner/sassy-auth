import { AsyncLocalStorage } from 'node:async_hooks';

interface PrivateRelayStore {
  isPrivateEmail: boolean;
}

const storage = new AsyncLocalStorage<PrivateRelayStore>();

/**
 * task-8 fix round 1 (review finding 1): hand Apple's `is_private_email`
 * claim back from `mapProfileToUser` — a callback invoked deep inside
 * BetterAuth's own `getUserInfo`, unreachable by direct return value — to
 * this request's `hooks.after` matcher in auth.config.ts.
 *
 * Mirrors ../auth/reset-url-context.ts's use of AsyncLocalStorage for the
 * exact same shape of problem ("a value written from inside a BetterAuth
 * callback must reach code running later in the same request, without a
 * module-level variable that concurrent sign-ins would cross-contaminate").
 *
 * Unlike reset-url-context.ts, the write (mapProfileToUser, invoked from
 * inside the /callback/:id endpoint handler) and the read (hooks.after,
 * invoked afterward by BetterAuth's own framework code) are two separate
 * calls made by BetterAuth itself, not something this codebase can wrap in
 * a single function call the way `runWithResetUrlCapture` wraps a single
 * `auth.api.forgetPassword(...)`-style call. The scope this module opens
 * must therefore span the ENTIRE request — see main.ts, where
 * `runWithPrivateRelayCapture` wraps the call into `toNodeHandler(auth)`.
 * That works because better-auth@1.6.11's `to-auth-endpoints.mjs` `run()`
 * drives before-hooks, the endpoint handler (where `getUserInfo` /
 * `mapProfileToUser` fire — @better-auth/core/social-providers/apple.mjs:
 * 71-95), and after-hooks as sequential `await`s inside ONE async function
 * per request: opening the AsyncLocalStorage scope before that function
 * starts keeps it visible for its entire, single continuation. Node's
 * AsyncLocalStorage.run() creates a properly isolated, auto-popped scope
 * per call, so two concurrent sign-ins — each wrapped in its own
 * `runWithPrivateRelayCapture` call by the same Express middleware — get
 * independent stores; see apple-private-relay-context.spec.ts's
 * concurrency test for a runtime proof.
 */
export function runWithPrivateRelayCapture<T>(fn: () => T): T {
  return storage.run({ isPrivateEmail: false }, fn);
}

/** Called from Apple's mapProfileToUser (build-social-providers.ts). No-op
 * outside a capture scope — e.g. a non-Apple provider never calls this. */
export function captureIsPrivateEmail(isPrivateEmail: boolean): void {
  const store = storage.getStore();
  if (store) store.isPrivateEmail = isPrivateEmail;
}

/**
 * Read the flag captured for this request. Returns `false` outside any
 * capture scope, when `mapProfileToUser` never ran (any non-Apple
 * provider), or when Apple genuinely reported `is_private_email: false` —
 * all three are indistinguishable by design, since `false` is the correct,
 * safe default for classifyRejection's `isPrivateEmail` input in every one
 * of those cases.
 */
export function readIsPrivateEmail(): boolean {
  return storage.getStore()?.isPrivateEmail ?? false;
}
