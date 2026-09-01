-- task-13 fix (found by the e2e acceptance gate, not by any prior unit
-- test): the earlier `social_providers_global_seed` migration seeds a
-- global row (appId = NULL) for google/microsoft/apple only. `stub` never
-- got one, anywhere — not in that migration, not in seed.ts, not in
-- demo-resource-server.ts (which only upserts an APP-SCOPED stub row for
-- resourceserver01). resolveEnabledProviders (resolve-enabled-providers.ts)
-- requires a global row to exist before it even looks at the app-scoped
-- row (`if (!globalRow) return false`), so on a genuinely fresh database —
-- exactly what CI's e2e job creates — the "Continue with Test IdP" button
-- would never render and the entire federated round-trip acceptance gate
-- would fail before the first assertion, for a reason that has nothing to
-- do with the browser flow itself.
--
-- Safe in every environment for the same reason the three rows above are
-- safe: a global row only declares the deployment "has" the provider.
-- Actual availability is still gated at runtime by
-- `availableSocialProviders()` (stub requires NODE_ENV to be exactly
-- 'test' or 'development' AND E2E_STUB_IDP_URL to be set — a positive
-- allowlist, not a blocklist) and independently by the genericOAuth plugin
-- itself never registering the provider outside that same allowlist
-- (see stub-provider.ts and task-11-report.md's "two independent locks"
-- note). So this row is inert in production regardless.
--
-- Same idempotency reasoning as the sibling migration: WHERE NOT EXISTS,
-- not ON CONFLICT DO NOTHING, because Postgres treats NULL "appId" values
-- as distinct for uniqueness purposes and ON CONFLICT would never fire.
INSERT INTO "SaSocialProvider" ("appId", "provider", "enabled", "createdAt", "updatedAt")
SELECT NULL, 'stub', true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "SaSocialProvider" WHERE "appId" IS NULL AND "provider" = 'stub'
);
