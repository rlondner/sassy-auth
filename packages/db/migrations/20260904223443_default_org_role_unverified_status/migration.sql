-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'unverified';

-- AlterTable
ALTER TABLE "SaApp" ADD COLUMN     "defaultOrgId" INTEGER,
ADD COLUMN     "defaultRoleId" INTEGER;

-- AddForeignKey
ALTER TABLE "SaApp" ADD CONSTRAINT "SaApp_defaultOrgId_fkey" FOREIGN KEY ("defaultOrgId") REFERENCES "SaOrg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaApp" ADD CONSTRAINT "SaApp_defaultRoleId_fkey" FOREIGN KEY ("defaultRoleId") REFERENCES "SaRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
