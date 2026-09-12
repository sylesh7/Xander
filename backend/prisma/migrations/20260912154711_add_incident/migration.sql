-- AlterTable
ALTER TABLE "Investigation" ADD COLUMN     "affectedRelationships" JSONB,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "contradictingEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "hypothesis" TEXT,
ADD COLUMN     "incidentId" TEXT,
ADD COLUMN     "recommendedAction" TEXT,
ADD COLUMN     "supportingEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "clusterId" TEXT,
    "campaignId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "rootCause" TEXT,
    "investigationId" TEXT,
    "source" TEXT NOT NULL,
    "detail" TEXT,
    "mitigation" TEXT,
    "mitigationReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Incident_status_severity_idx" ON "Incident"("status", "severity");

-- CreateIndex
CREATE INDEX "Incident_actorId_idx" ON "Incident"("actorId");

-- CreateIndex
CREATE INDEX "Incident_openedAt_idx" ON "Incident"("openedAt");

-- CreateIndex
CREATE INDEX "Investigation_incidentId_idx" ON "Investigation"("incidentId");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
