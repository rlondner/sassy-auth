-- Seed a global row per provider. A global row (appId = NULL) declares that
-- this deployment has credentials for the provider; the runtime still gates
-- actual availability on the env credential pair (resolve-enabled-providers.ts),
-- so seeding a row for a provider with no credentials is inert.
--
-- Each row is guarded with a WHERE NOT EXISTS check instead of
-- ON CONFLICT DO NOTHING: the unique index is on ("appId", "provider"), and
-- Postgres treats NULL "appId" values as distinct from one another for
-- uniqueness purposes, so ON CONFLICT would never fire for these rows and a
-- second run would insert duplicates. WHERE NOT EXISTS is genuinely
-- idempotent regardless of how NULLs are compared for uniqueness.
INSERT INTO "SaSocialProvider" ("appId", "provider", "enabled", "createdAt", "updatedAt")
SELECT NULL, 'google', true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "SaSocialProvider" WHERE "appId" IS NULL AND "provider" = 'google'
);

INSERT INTO "SaSocialProvider" ("appId", "provider", "enabled", "createdAt", "updatedAt")
SELECT NULL, 'microsoft', true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "SaSocialProvider" WHERE "appId" IS NULL AND "provider" = 'microsoft'
);

INSERT INTO "SaSocialProvider" ("appId", "provider", "enabled", "createdAt", "updatedAt")
SELECT NULL, 'apple', true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "SaSocialProvider" WHERE "appId" IS NULL AND "provider" = 'apple'
);
