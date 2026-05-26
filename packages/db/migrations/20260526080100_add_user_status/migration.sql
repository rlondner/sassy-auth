-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'pending', 'inactive');

-- AlterTable
ALTER TABLE "SaUser" ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'pending';
