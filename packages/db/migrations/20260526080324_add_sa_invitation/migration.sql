-- CreateTable
CREATE TABLE "SaInvitation" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaInvitation_publicId_key" ON "SaInvitation"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "SaInvitation_token_key" ON "SaInvitation"("token");

-- CreateIndex
CREATE INDEX "SaInvitation_token_idx" ON "SaInvitation"("token");

-- CreateIndex
CREATE INDEX "SaInvitation_userId_idx" ON "SaInvitation"("userId");

-- AddForeignKey
ALTER TABLE "SaInvitation" ADD CONSTRAINT "SaInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "SaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
