import { OpenAPIObject } from '@nestjs/swagger';

const BETTER_AUTH_PATH_PREFIX = '/api/auth';

export function mergeOpenApiDocs(
  nestDoc: OpenAPIObject,
  betterAuthDoc: OpenAPIObject,
): OpenAPIObject {
  const mergedPaths: Record<string, unknown> = { ...(nestDoc.paths ?? {}) };
  for (const [path, item] of Object.entries(betterAuthDoc.paths ?? {})) {
    mergedPaths[`${BETTER_AUTH_PATH_PREFIX}${path}`] = item;
  }

  const nestSchemas = nestDoc.components?.schemas ?? {};
  const baSchemas = betterAuthDoc.components?.schemas ?? {};
  const mergedSchemas: Record<string, unknown> = { ...nestSchemas };
  for (const [name, schema] of Object.entries(baSchemas)) {
    const key = name in nestSchemas ? `${name}_BetterAuth` : name;
    mergedSchemas[key] = schema;
  }

  const nestSecurity = nestDoc.components?.securitySchemes ?? {};
  const baSecurity = betterAuthDoc.components?.securitySchemes ?? {};
  const mergedSecurity: Record<string, unknown> = { ...nestSecurity };
  for (const [name, scheme] of Object.entries(baSecurity)) {
    if (!(name in nestSecurity)) {
      mergedSecurity[name] = scheme;
    }
  }

  const tagMap = new Map<string, { name: string; description?: string }>();
  for (const t of nestDoc.tags ?? []) tagMap.set(t.name, t);
  for (const t of betterAuthDoc.tags ?? []) if (!tagMap.has(t.name)) tagMap.set(t.name, t);
  const mergedTags = [...tagMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...nestDoc,
    paths: mergedPaths,
    components: {
      ...nestDoc.components,
      schemas: mergedSchemas,
      securitySchemes: mergedSecurity,
    },
    tags: mergedTags,
  } as OpenAPIObject;
}

// BetterAuth's open-api plugin dumps ~30 unrelated endpoints (sign-in,
// session management, account changes, password reset, ...) under one
// "Default" tag. Path -> replacement-tag map, built by hand from BetterAuth's
// own route list rather than any pattern match, since there's no naming
// convention in the paths themselves to key off (e.g. /update-user is
// "Account" but /update-session is "Session"). Exhaustive over the current
// route set; anything not listed here (currently just /ok and /error) stays
// tagged "Default", displayed as "Better Auth" — see recategorizeBetterAuthTags.
const BETTER_AUTH_TAG_OVERRIDES: ReadonlyArray<readonly [string, string]> = [
  ['/sign-in/email', 'Sign In & Sign Up'],
  ['/sign-in/social', 'Sign In & Sign Up'],
  ['/sign-up/email', 'Sign In & Sign Up'],
  ['/sign-out', 'Sign In & Sign Up'],
  ['/callback/{id}', 'Sign In & Sign Up'],
  ['/get-session', 'Session'],
  ['/update-session', 'Session'],
  ['/list-sessions', 'Session'],
  ['/revoke-session', 'Session'],
  ['/revoke-sessions', 'Session'],
  ['/revoke-other-sessions', 'Session'],
  ['/refresh-token', 'Session'],
  ['/get-access-token', 'Session'],
  ['/update-user', 'Account'],
  ['/delete-user', 'Account'],
  ['/delete-user/callback', 'Account'],
  ['/change-email', 'Account'],
  ['/change-password', 'Account'],
  ['/account-info', 'Account'],
  ['/list-accounts', 'Account'],
  ['/link-social', 'Account'],
  ['/unlink-account', 'Account'],
  ['/reset-password', 'Password & Verification'],
  ['/reset-password/{token}', 'Password & Verification'],
  ['/request-password-reset', 'Password & Verification'],
  ['/verify-password', 'Password & Verification'],
  ['/verify-email', 'Password & Verification'],
  ['/send-verification-email', 'Password & Verification'],
];

const BETTER_AUTH_TAG_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'Sign In & Sign Up': 'Credential and social sign-in, sign-up, sign-out, and OAuth callback handling.',
  Session: 'Reading, refreshing, and revoking the current or other active sessions.',
  Account: 'Managing the signed-in user’s profile, linked accounts, email, and password.',
  'Password & Verification': 'Password reset flow and email verification.',
};

/**
 * Splits BetterAuth's single catch-all "Default" tag into the categories
 * above, based on path. Everything left tagged "Default" (endpoints not in
 * BETTER_AUTH_TAG_OVERRIDES) is relabeled "Better Auth" via x-displayName,
 * since "Default" reads as a placeholder, not a real section name, in the
 * ReDoc/Swagger UI sidebar.
 */
export function recategorizeBetterAuthTags(doc: OpenAPIObject): OpenAPIObject {
  const overrides = new Map(
    BETTER_AUTH_TAG_OVERRIDES.map(([path, tag]) => [`${BETTER_AUTH_PATH_PREFIX}${path}`, tag]),
  );

  const paths: Record<string, unknown> = { ...(doc.paths ?? {}) };
  for (const [path, newTag] of overrides) {
    const pathItem = paths[path] as Record<string, { tags?: string[] }> | undefined;
    if (!pathItem) continue;

    const updatedItem: Record<string, unknown> = { ...pathItem };
    for (const [method, operation] of Object.entries(pathItem)) {
      if (operation?.tags?.includes('Default')) {
        updatedItem[method] = { ...operation, tags: [newTag] };
      }
    }
    paths[path] = updatedItem;
  }

  const newTagDescriptors = [...new Set(overrides.values())].map((name) => ({
    name,
    description: BETTER_AUTH_TAG_DESCRIPTIONS[name],
  }));

  const tags = [
    ...(doc.tags ?? []).filter((t) => t.name !== 'Default'),
    ...newTagDescriptors,
    {
      name: 'Default',
      description: 'Miscellaneous BetterAuth endpoints not covered by a specific category.',
      'x-displayName': 'Better Auth',
    },
  ];

  return { ...doc, paths, tags } as OpenAPIObject;
}

/**
 * Stamps ReDoc's vendor extensions (x-logo, x-tagGroups) onto an already-merged
 * OpenAPI document. Harmless for Swagger UI, which ignores unknown x-* keys, so
 * the same enriched document backs /api/docs, /api/docs-json, /api/docs-yaml,
 * and /api/redoc.
 */
export function applyRedocExtensions(doc: OpenAPIObject): OpenAPIObject {
  // Nest's DocumentBuilder never populates the document's top-level `tags[]`
  // from @ApiTags() alone (that only tags individual operations, not the
  // document) — only explicit .addTag() calls would. So group membership is
  // derived from where each tag is actually used across `paths`, not from
  // doc.tags, otherwise a tag ReDoc would render un-grouped (and therefore
  // hide entirely, per x-tagGroups' "ungrouped tag is invisible" rule).
  //
  // BetterAuth's open-api plugin also spreads its own routes across several
  // tags (Default, Magic-link, Email-otp, Two-factor, ...) rather than one
  // "Auth" tag, so tag *name* can't tell Authentication and Management API
  // routes apart. Path prefix can: every BetterAuth route is re-rooted under
  // /api/auth/* by mergeOpenApiDocs above, and no Nest route lives there.
  const authTags = new Set<string>();
  const managementTags = new Set<string>();
  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    const bucket = path.startsWith(BETTER_AUTH_PATH_PREFIX) ? authTags : managementTags;
    for (const operation of Object.values(pathItem as Record<string, { tags?: string[] }>)) {
      for (const tag of operation?.tags ?? []) bucket.add(tag);
    }
  }

  const tagGroups = [
    { name: 'Authentication', tags: [...authTags] },
    { name: 'Management API', tags: [...managementTags] },
  ].filter((group) => group.tags.length > 0);

  return {
    ...doc,
    // x-logo is an Info Object extension (nests under `info`), not a root
    // one — unlike x-tagGroups, which is root-level. Misplacing it at the
    // root leaves ReDoc's sidebar with no logo request at all, silently.
    info: {
      ...doc.info,
      'x-logo': {
        url: '/api/redoc-logo.jpg',
        backgroundColor: '#ffffff',
        altText: 'SassyAuth',
      },
    },
    'x-tagGroups': tagGroups,
  } as OpenAPIObject;
}
