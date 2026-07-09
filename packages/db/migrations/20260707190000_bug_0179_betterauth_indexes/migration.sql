-- bug-0179: BetterAuth reads Session, Account, and Verification rows
-- by userId / identifier on every authenticated request. Without
-- these indexes the DB falls back to sequential scans whose cost
-- grows linearly with total row count across ALL users. On a busy
-- deployment this shows up as sign-in latency creeping up over
-- weeks — one of the classic "worked in dev, degraded in prod"
-- shapes.

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- bug-0187: `SaInvitation.token` already carries a unique btree via
-- the `@unique` constraint (index `SaInvitation_token_key`). The
-- separate `@@index([token])` produced a second identical non-unique
-- index that only cost bytes on disk and time on every insert / delete.

-- DropIndex
DROP INDEX "SaInvitation_token_idx";
