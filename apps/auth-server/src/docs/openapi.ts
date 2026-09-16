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
