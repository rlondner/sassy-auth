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

-- Seed a global row per provider. Enablement is still gated on the env
-- credential pair at runtime (resolve-enabled-providers.ts), so seeding a row
-- for a provider with no credentials is inert.
INSERT INTO "SaSocialProvider" ("appId", "provider", "enabled", "createdAt", "updatedAt")
VALUES (NULL, 'google', true, NOW(), NOW()),
       (NULL, 'microsoft', true, NOW(), NOW()),
       (NULL, 'apple', true, NOW(), NOW())
ON CONFLICT DO NOTHING;
