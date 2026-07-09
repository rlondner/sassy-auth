-- bug-0186: expose real `createdAt` and `lastLoginAt` on the SaUser
-- API. `createdAt` is NOT NULL with a CURRENT_TIMESTAMP default so
-- existing rows get backfilled to "now" at migration time (there is
-- no historical creation timestamp to recover). `lastLoginAt` is
-- nullable — null means the user has never signed in, which is
-- correct for every existing row before the runtime hooks that
-- populate it start firing.

-- AlterTable
ALTER TABLE "SaUser" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "SaUser" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
