import { AsyncLocalStorage } from 'node:async_hooks';

interface ResetUrlStore {
  url: string | null;
}

const storage = new AsyncLocalStorage<ResetUrlStore>();

/** Run `fn` in a scope where sendResetPassword can hand back the generated URL. */
export async function runWithResetUrlCapture<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; resetUrl: string | null }> {
  const store: ResetUrlStore = { url: null };
  const result = await storage.run(store, fn);
  return { result, resetUrl: store.url };
}

/** Called from the sendResetPassword hook. No-op when not inside a capture scope. */
export function captureResetUrl(url: string): void {
  const store = storage.getStore();
  if (store) store.url = url;
}
