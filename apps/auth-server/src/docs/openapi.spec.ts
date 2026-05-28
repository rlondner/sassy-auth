import { mergeOpenApiDocs } from './openapi';

const baseNest = {
  openapi: '3.0.0',
  info: { title: 'Sassy Auth API', version: '0.0.1', description: 'API' },
  paths: {
    '/api/users': { get: { tags: ['Users'], responses: { '200': { description: 'OK' } } } },
  },
  components: { schemas: {}, securitySchemes: {} },
  tags: [{ name: 'Users' }],
};

const baseBetterAuth = {
  openapi: '3.1.0',
  info: { title: 'Better Auth', version: '1.0.0', description: 'BA' },
  paths: {
    '/sign-in/email': { post: { responses: { '200': { description: 'OK' } } } },
    '/sign-out': { post: { responses: { '200': { description: 'OK' } } } },
  },
  components: { schemas: {}, securitySchemes: {} },
  tags: [],
};

describe('mergeOpenApiDocs', () => {
  it('prefixes better-auth paths with /api/auth and merges them with nest paths', () => {
    const merged = mergeOpenApiDocs(baseNest as any, baseBetterAuth as any);

    expect(Object.keys(merged.paths).sort()).toEqual([
      '/api/auth/sign-in/email',
      '/api/auth/sign-out',
      '/api/users',
    ]);
  });

  it('merges component schemas and suffixes BetterAuth schemas on name collision', () => {
    const nest = {
      ...baseNest,
      components: {
        schemas: {
          CreateUserDto: { type: 'object', properties: { email: { type: 'string' } } },
          SessionUser: { type: 'object', properties: { id: { type: 'string' } } },
        },
        securitySchemes: {},
      },
    };
    const ba = {
      ...baseBetterAuth,
      components: {
        schemas: {
          AuthSession: { type: 'object' },
          SessionUser: { type: 'object', properties: { email: { type: 'string' } } },
        },
        securitySchemes: {},
      },
    };

    const merged = mergeOpenApiDocs(nest as any, ba as any);
    const schemas = merged.components!.schemas!;

    expect(schemas).toHaveProperty('CreateUserDto');
    expect(schemas).toHaveProperty('AuthSession');
    expect(schemas).toHaveProperty('SessionUser');
    expect(schemas).toHaveProperty('SessionUser_BetterAuth');
  });

  it('keeps the nest cookieAuth scheme and drops the BetterAuth equivalent on conflict', () => {
    const nest = {
      ...baseNest,
      components: {
        schemas: {},
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'better-auth.session_token',
          },
        },
      },
    };
    const ba = {
      ...baseBetterAuth,
      components: {
        schemas: {},
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'some-other-name',
          },
          apiKeyCookie: { type: 'apiKey', in: 'cookie', name: 'x' },
        },
      },
    };

    const merged = mergeOpenApiDocs(nest as any, ba as any);
    const schemes = merged.components!.securitySchemes!;

    expect((schemes['cookieAuth'] as any).name).toBe('better-auth.session_token');
    expect(schemes).toHaveProperty('apiKeyCookie');
  });

  it('preserves nest info and produces a sorted union of tags', () => {
    const nest = {
      ...baseNest,
      tags: [{ name: 'Users' }, { name: 'Orgs' }],
    };
    const ba = {
      ...baseBetterAuth,
      tags: [{ name: 'Auth' }, { name: 'Users' }], // intentional duplicate
    };

    const merged = mergeOpenApiDocs(nest as any, ba as any);

    expect(merged.info.title).toBe('Sassy Auth API');
    expect((merged.tags ?? []).map((t) => t.name)).toEqual(['Auth', 'Orgs', 'Users']);
  });

  it('returns the nest doc with no BetterAuth additions when the BetterAuth doc is empty', () => {
    const merged = mergeOpenApiDocs(baseNest as any, {} as any);

    expect(Object.keys(merged.paths)).toEqual(['/api/users']);
    expect(merged.info.title).toBe('Sassy Auth API');
  });
});
