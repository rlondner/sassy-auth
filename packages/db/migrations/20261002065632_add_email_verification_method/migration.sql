-- CreateEnum
CREATE TYPE "EmailVerificationMethod" AS ENUM ('link', 'code');

-- AlterTable
ALTER TABLE "SaApp" ADD COLUMN     "emailVerificationMethod" "EmailVerificationMethod" NOT NULL DEFAULT 'link';
