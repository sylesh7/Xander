-- DropIndex
DROP INDEX "EvidenceEvent_wallet_idx";

-- DropIndex
DROP INDEX "Incident_openedAt_idx";

-- DropIndex
DROP INDEX "Incident_status_severity_idx";

-- CreateIndex
CREATE INDEX "EvidenceEvent_wallet_timestamp_idx" ON "EvidenceEvent"("wallet", "timestamp");

-- CreateIndex
CREATE INDEX "Incident_status_severity_openedAt_idx" ON "Incident"("status", "severity", "openedAt");

-- CreateIndex
CREATE INDEX "Wallet_clusterId_idx" ON "Wallet"("clusterId");
