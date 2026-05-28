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
