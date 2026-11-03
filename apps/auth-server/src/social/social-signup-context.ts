import { AsyncLocalStorage } from 'node:async_hooks';

interface SocialSignupStore {
  clientId: string | null;
  givenName: string | null;
  familyName: string | null;
}

const storage = new AsyncLocalStorage<SocialSignupStore>();

/**
 * Hands two pieces of data captured mid-request — by auth.config.ts's
 * hooks.before matcher (clientId, see design doc §3a) and by Google/
 * Microsoft's mapProfileToUser (givenName/familyName, see design doc §4) —
 * forward to the later databaseHooks.user.create.after hook, which has no
 * direct access to either. Mirrors apple-private-relay-context.ts and
 * social-consent-context.ts's identical use of AsyncLocalStorage for the
 * same shape of problem: this scope must wrap the entire request (see
 * main.ts, where it joins the other two runWith...Capture wrappers around
 * toNodeHandler(auth)).
 */
export function runWithSocialSignupContext<T>(fn: () => T): T {
  return storage.run({ clientId: null, givenName: null, familyName: null }, fn);
}

/** Called from auth.config.ts's hooks.before matcher on /callback/:id. */
export function captureSocialSignupClientId(clientId: string | null): void {
  const store = storage.getStore();
  if (store) store.clientId = clientId;
}

/** Called from Google's/Microsoft's mapProfileToUser (build-social-providers.ts). */
export function captureSocialSignupProfileName(givenName: string | null, familyName: string | null): void {
  const store = storage.getStore();
  if (store) {
    store.givenName = givenName;
    store.familyName = familyName;
  }
}

/** Read what this request has captured so far. All fields null outside any
 * capture scope. */
export function readSocialSignupContext(): SocialSignupStore {
  const store = storage.getStore();
  return { clientId: store?.clientId ?? null, givenName: store?.givenName ?? null, familyName: store?.familyName ?? null };
}
