// task-4: BetterAuth's databaseHooks context does NOT carry the literal
// request path. `ctx.path` here is `endpoint.path` — the *route template*
// registered with better-call (e.g. "/callback/:id" or
// "/oauth2/callback/:providerId") — not the resolved URL. Confirmed by
// reading better-auth 1.6.11's own to-auth-endpoints.mjs, where
// `internalContext = { ...context, path: endpoint.path, ... }` overwrites the
// router's literal `context.path` with the template before storing it in
// AsyncLocalStorage; databaseHooks read that same stored context. The
// provider name therefore only exists in `ctx.params` (populated by
// better-call's router from the actual URL and left untouched by that
// spread). BetterAuth's own bundled `last-login-method` plugin
// (dist/plugins/last-login-method/index.mjs) hits the same wall and works
// around it the same way: `ctx.params?.id || ctx.params?.providerId`.
// This helper reconstructs a signInMethodFromPath-shaped literal path from
// the template + params so the pure function's regex still matches.
export function resolveHookRoutePath(
  ctx: { path?: string; params?: Record<string, string> } | null | undefined,
): string | undefined {
  if (!ctx) return undefined;
  const template = ctx.path;
  if (!template) return undefined;
  if (template.startsWith('/callback/')) {
    const id = ctx.params?.id;
    return id ? `/callback/${id}` : undefined;
  }
  if (template.startsWith('/oauth2/callback/')) {
    const id = ctx.params?.providerId;
    return id ? `/oauth2/callback/${id}` : undefined;
  }
  // Un-templated routes (e.g. "/sign-in/email") have no params to substitute;
  // the template *is* the literal path.
  return template;
}
