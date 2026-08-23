import { resolveHookRoutePath } from './resolve-hook-route-path';
import { signInMethodFromPath } from './sign-in-method';

describe('resolveHookRoutePath', () => {
  it('substitutes ctx.params.id into the /callback/:id template', () => {
    expect(resolveHookRoutePath({ path: '/callback/:id', params: { id: 'google' } })).toBe(
      '/callback/google',
    );
  });

  it('substitutes ctx.params.providerId into the /oauth2/callback/:providerId template', () => {
    expect(
      resolveHookRoutePath({
        path: '/oauth2/callback/:providerId',
        params: { providerId: 'stub' },
      }),
    ).toBe('/oauth2/callback/stub');
  });

  it('passes an un-templated route through unchanged, keeping password sign-in recording pwd', () => {
    expect(resolveHookRoutePath({ path: '/sign-in/email', params: {} })).toBe('/sign-in/email');
  });

  it('does not fabricate a path that maps to a real provider when the param is missing', () => {
    const result = resolveHookRoutePath({ path: '/callback/:id', params: {} });
    // Whatever shape this takes (undefined, the raw template, etc.), it must
    // never resolve to a literal `ext:<provider>` classification downstream.
    expect(result).toBeUndefined();
    expect(signInMethodFromPath(result)).toBeNull();
  });

  it('does not throw when params is entirely absent', () => {
    expect(() => resolveHookRoutePath({ path: '/callback/:id' })).not.toThrow();
    expect(resolveHookRoutePath({ path: '/callback/:id' })).toBeUndefined();
  });

  it('returns undefined for a null/undefined context', () => {
    expect(resolveHookRoutePath(null)).toBeUndefined();
    expect(resolveHookRoutePath(undefined)).toBeUndefined();
  });

  it('composes with signInMethodFromPath end-to-end: a /callback/:id context yields ext:google', () => {
    const path = resolveHookRoutePath({ path: '/callback/:id', params: { id: 'google' } });
    expect(signInMethodFromPath(path)).toBe('ext:google');
  });
});
