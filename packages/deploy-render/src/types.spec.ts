import type { FetchLike } from './types';

describe('FetchLike', () => {
  it('accepts a function matching the global fetch signature', () => {
    const fn: FetchLike = async (_url, _init) => new Response('ok');
    expect(typeof fn).toBe('function');
  });
});
