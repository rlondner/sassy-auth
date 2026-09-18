-- AlterTable
ALTER TABLE "SaApp" ADD COLUMN     "allowOfflineAccess" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SaRefreshToken" (
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "saUserId" INTEGER NOT NULL,
    "userPublicId" TEXT NOT NULL,
    "orgPublicId" TEXT NOT NULL,
    "appId" INTEGER NOT NULL,
    "appPublicId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "amr" TEXT NOT NULL,
    "idp" TEXT,
    "authTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByTokenHash" TEXT,

    CONSTRAINT "SaRefreshToken_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "SaRefreshToken_familyId_idx" ON "SaRefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "SaRefreshToken_saUserId_idx" ON "SaRefreshToken"("saUserId");

-- CreateIndex
CREATE INDEX "SaRefreshToken_expiresAt_idx" ON "SaRefreshToken"("expiresAt");
