-- CreateTable
CREATE TABLE "SaSocialProvider" (
    "id" SERIAL NOT NULL,
    "appId" INTEGER,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaSocialProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaSocialProvider_appId_idx" ON "SaSocialProvider"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "SaSocialProvider_appId_provider_key" ON "SaSocialProvider"("appId", "provider");

-- AddForeignKey
ALTER TABLE "SaSocialProvider" ADD CONSTRAINT "SaSocialProvider_appId_fkey" FOREIGN KEY ("appId") REFERENCES "SaApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
