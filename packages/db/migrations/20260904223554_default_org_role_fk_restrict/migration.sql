-- DropForeignKey
ALTER TABLE "SaApp" DROP CONSTRAINT "SaApp_defaultOrgId_fkey";

-- DropForeignKey
ALTER TABLE "SaApp" DROP CONSTRAINT "SaApp_defaultRoleId_fkey";

-- AddForeignKey
ALTER TABLE "SaApp" ADD CONSTRAINT "SaApp_defaultOrgId_fkey" FOREIGN KEY ("defaultOrgId") REFERENCES "SaOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaApp" ADD CONSTRAINT "SaApp_defaultRoleId_fkey" FOREIGN KEY ("defaultRoleId") REFERENCES "SaRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
