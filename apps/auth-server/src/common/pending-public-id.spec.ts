import { generatePendingPublicId } from './pending-public-id';

describe('generatePendingPublicId', () => {
  it('returns a value prefixed with `pending-` so the seed housekeeping matches it', () => {
    expect(generatePendingPublicId()).toMatch(/^pending-/);
  });

  // bug-0148 — the previous literal `'placeholder'` caused two concurrent
  // creates to collide on the SaX.publicId unique constraint. The fix makes
  // every call return a fresh, high-entropy value so the collision surface
  // shrinks to the UUID birthday-bound (2^61-ish attempts).
  it('produces a unique value across a batch of concurrent calls', () => {
    const N = 1000;
    const values = new Set<string>();
    for (let i = 0; i < N; i++) values.add(generatePendingPublicId());
    expect(values.size).toBe(N);
  });
});
