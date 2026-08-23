import {
  runWithPrivateRelayCapture,
  captureIsPrivateEmail,
  readIsPrivateEmail,
} from './apple-private-relay-context';

describe('apple-private-relay-context', () => {
  it('captures true written from inside the scope', async () => {
    const result = await runWithPrivateRelayCapture(async () => {
      captureIsPrivateEmail(true);
      return readIsPrivateEmail();
    });
    expect(result).toBe(true);
  });

  it('captures false written from inside the scope', async () => {
    const result = await runWithPrivateRelayCapture(async () => {
      captureIsPrivateEmail(false);
      return readIsPrivateEmail();
    });
    expect(result).toBe(false);
  });

  it('defaults to false inside a scope where capture is never called (e.g. a non-Apple provider)', async () => {
    const result = await runWithPrivateRelayCapture(async () => readIsPrivateEmail());
    expect(result).toBe(false);
  });

  it('readIsPrivateEmail outside any scope is false and does not throw', () => {
    expect(() => readIsPrivateEmail()).not.toThrow();
    expect(readIsPrivateEmail()).toBe(false);
  });

  it('captureIsPrivateEmail outside any scope is a no-op (no throw)', () => {
    expect(() => captureIsPrivateEmail(true)).not.toThrow();
    // And does not leak into a later, unrelated scope.
    expect(readIsPrivateEmail()).toBe(false);
  });

  // The load-bearing property this whole mechanism depends on: two
  // concurrent sign-ins (two concurrent runWithPrivateRelayCapture scopes,
  // as main.ts's middleware opens one per request) must not see each
  // other's captured value — otherwise a private-relay signal from user B
  // could tell user A they used Hide My Email, or vice versa.
  it('isolates concurrent capture scopes from each other', async () => {
    const [a, b] = await Promise.all([
      runWithPrivateRelayCapture(async () => {
        captureIsPrivateEmail(true);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return readIsPrivateEmail();
      }),
      runWithPrivateRelayCapture(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        // Never captures — should stay false even though the sibling scope
        // captured true and is still "in flight" when this resolves.
        return readIsPrivateEmail();
      }),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(false);
  });
});
