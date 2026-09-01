-- CreateTable
CREATE TABLE "SaAuditEvent" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT,
    "saUserId" INTEGER,
    "betterAuthUserId" TEXT,
    "appPublicId" TEXT,
    "email" TEXT,
    "providerSub" TEXT,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SaAuditEvent_publicId_key" ON "SaAuditEvent"("publicId");

-- CreateIndex
CREATE INDEX "SaAuditEvent_type_createdAt_idx" ON "SaAuditEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SaAuditEvent_saUserId_idx" ON "SaAuditEvent"("saUserId");
