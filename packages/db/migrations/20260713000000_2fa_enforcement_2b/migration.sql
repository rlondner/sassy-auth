-- AlterTable
ALTER TABLE "SaApp" ADD COLUMN "requireTwoFactor" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SaOauthCode" ADD COLUMN "amr" TEXT NOT NULL DEFAULT '["pwd"]';
