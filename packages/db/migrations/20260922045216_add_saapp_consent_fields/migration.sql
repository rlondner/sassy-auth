-- AlterTable
ALTER TABLE "SaApp" ADD COLUMN     "gdprUrl" TEXT,
ADD COLUMN     "privacyPolicyUrl" TEXT,
ADD COLUMN     "termsUrl" TEXT;

-- CreateTable
CREATE TABLE "SaUserConsent" (
    "id" SERIAL NOT NULL,
    "saUserId" INTEGER NOT NULL,
    "appId" INTEGER NOT NULL,
    "documentType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaUserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaUserConsent_appId_idx" ON "SaUserConsent"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "SaUserConsent_saUserId_appId_documentType_key" ON "SaUserConsent"("saUserId", "appId", "documentType");

-- AddForeignKey
ALTER TABLE "SaUserConsent" ADD CONSTRAINT "SaUserConsent_saUserId_fkey" FOREIGN KEY ("saUserId") REFERENCES "SaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaUserConsent" ADD CONSTRAINT "SaUserConsent_appId_fkey" FOREIGN KEY ("appId") REFERENCES "SaApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
