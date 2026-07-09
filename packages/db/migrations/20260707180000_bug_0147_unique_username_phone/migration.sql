-- bug-0147: enforce uniqueness of SaUser.username and SaUser.phoneNumber
-- across the whole table. Postgres treats NULLs as distinct in a
-- standard unique index, so users with NULL username / phoneNumber
-- continue to coexist while non-NULL values become globally unique.
-- This lets `directLogin` do `findUnique({ where: { username } })`
-- instead of `findFirst`, closing the cross-tenant collision.

-- DropIndex
DROP INDEX "SaUser_username_idx";

-- DropIndex
DROP INDEX "SaUser_phoneNumber_idx";

-- CreateIndex
CREATE UNIQUE INDEX "SaUser_phoneNumber_key" ON "SaUser"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SaUser_username_key" ON "SaUser"("username");
