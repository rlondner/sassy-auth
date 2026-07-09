-- ─────────────────────────────────────────────────────────────────────
-- 1. Mark every existing org.* perm as system.
-- ─────────────────────────────────────────────────────────────────────
UPDATE "SaPermission"
SET    "isSystem" = true
WHERE  "name" LIKE 'org.%';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Insert platform.roles.manage and org.roles.manage if absent.
--    publicId is a placeholder; the seed (or a follow-up update query)
--    replaces it with a real sqid-encoded id on the next seed run.
--    The schema's @unique on name protects against duplicate inserts.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO "SaPermission" ("publicId", "name", "appId", "isSystem")
SELECT 'pending-roles-manage', 'platform.roles.manage', a.id, false
FROM   "SaApp" a
WHERE  a."isPlatform" = true
  AND  NOT EXISTS (SELECT 1 FROM "SaPermission" WHERE "name" = 'platform.roles.manage');

INSERT INTO "SaPermission" ("publicId", "name", "appId", "isSystem")
SELECT 'pending-org-roles-manage', 'org.roles.manage', a.id, true
FROM   "SaApp" a
WHERE  a."isPlatform" = true
  AND  NOT EXISTS (SELECT 1 FROM "SaPermission" WHERE "name" = 'org.roles.manage');

-- ─────────────────────────────────────────────────────────────────────
-- 3. Re-point role-level grants of org.permissions.manage → org.roles.manage.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO "SaRolePermission" ("roleId", "permissionId")
SELECT rp."roleId", new_perm.id
FROM   "SaRolePermission" rp
JOIN   "SaPermission" old_perm ON old_perm.id = rp."permissionId" AND old_perm.name = 'org.permissions.manage'
JOIN   "SaPermission" new_perm ON new_perm.name = 'org.roles.manage'
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Re-point user-level grants the same way.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO "SaUserPermission" ("userId", "permissionId")
SELECT up."userId", new_perm.id
FROM   "SaUserPermission" up
JOIN   "SaPermission" old_perm ON old_perm.id = up."permissionId" AND old_perm.name = 'org.permissions.manage'
JOIN   "SaPermission" new_perm ON new_perm.name = 'org.roles.manage'
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Delete the obsolete perm. ON DELETE CASCADE on the join tables
--    cleans up leftovers we already mirrored above.
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM "SaPermission" WHERE "name" = 'org.permissions.manage';

-- ─────────────────────────────────────────────────────────────────────
-- 6. Grant platform.roles.manage to the Platform Super Admin role,
--    so s@sa.io retains super-admin parity after the split.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO "SaRolePermission" ("roleId", "permissionId")
SELECT r.id, p.id
FROM   "SaRole" r
JOIN   "SaApp"  a ON a.id = r."appId" AND a."isPlatform" = true
JOIN   "SaPermission" p ON p.name = 'platform.roles.manage'
WHERE  r.name = 'Platform Super Admin'
ON CONFLICT DO NOTHING;
