-- bug-0144: SaInvitation is queried by `expiresAt` in validateToken
-- (comparison against now()) and by any cleanup job scanning for
-- expired unused tokens. Without an index those queries scan the
-- whole table; with one they're constant-time on the boundary rows.

-- CreateIndex
CREATE INDEX "SaInvitation_expiresAt_idx" ON "SaInvitation"("expiresAt");
