/*
  Warnings:

  - You are about to drop the column `callbackUrl` on the `SaApp` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SaApp" ADD COLUMN     "clientSecretHash" TEXT,
ADD COLUMN     "clientSecretUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SaOauthCode" ADD COLUMN     "authTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "nonce" TEXT,
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "codeChallenge" DROP NOT NULL,
ALTER COLUMN "codeChallengeMethod" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SaAppRedirectUri" (
    "id" SERIAL NOT NULL,
    "appId" INTEGER NOT NULL,
    "uri" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "SaAppRedirectUri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaAppRedirectUri_appId_kind_idx" ON "SaAppRedirectUri"("appId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SaAppRedirectUri_appId_uri_kind_key" ON "SaAppRedirectUri"("appId", "uri", "kind");

-- AddForeignKey
ALTER TABLE "SaAppRedirectUri" ADD CONSTRAINT "SaAppRedirectUri_appId_fkey" FOREIGN KEY ("appId") REFERENCES "SaApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every app with an explicit callbackUrl gets one registered login URI.
-- Apps with NULL callbackUrl intentionally get no rows, which preserves their
-- existing same-origin fallback matching (see redirect-uri.ts).
INSERT INTO "SaAppRedirectUri" ("appId", "uri", "kind")
SELECT "id", "callbackUrl", 'login'
FROM "SaApp"
WHERE "callbackUrl" IS NOT NULL AND "callbackUrl" <> '';

-- AlterTable
ALTER TABLE "SaApp" DROP COLUMN "callbackUrl";
