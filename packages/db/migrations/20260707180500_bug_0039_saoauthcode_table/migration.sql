-- bug-0039: move OAuth authorization codes from an in-memory Map into
-- a shared DB table so the auth-server can run multiple replicas.
-- Rows are inserted at /authorize and deleted at /token (or on any
-- validation failure) — see OauthService.exchangeCode. The
-- @@index([expiresAt]) supports an optional periodic cleanup job.

-- CreateTable
CREATE TABLE "SaOauthCode" (
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appPublicId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaOauthCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "SaOauthCode_expiresAt_idx" ON "SaOauthCode"("expiresAt");
