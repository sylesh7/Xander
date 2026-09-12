-- CreateTable
CREATE TABLE "TrustSnapshot" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "campaignId" TEXT,
    "behaviorIntegrity" DOUBLE PRECISION,
    "coordinationRisk" DOUBLE PRECISION,
    "historyStrength" DOUBLE PRECISION,
    "humanAssurance" DOUBLE PRECISION,
    "agentReputation" DOUBLE PRECISION,
    "evidenceFreshness" DOUBLE PRECISION,
    "investigationConfidence" DOUBLE PRECISION,
    "overallBand" TEXT NOT NULL,
    "dimensionsJson" JSONB NOT NULL,
    "driftJson" JSONB,
    "evidenceIds" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustSignal" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "positive" BOOLEAN NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "detail" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrustSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrustSnapshot_actorId_createdAt_idx" ON "TrustSnapshot"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "TrustSignal_actorId_createdAt_idx" ON "TrustSignal"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "TrustSignal_actorId_kind_idx" ON "TrustSignal"("actorId", "kind");

-- AddForeignKey
ALTER TABLE "TrustSnapshot" ADD CONSTRAINT "TrustSnapshot_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustSignal" ADD CONSTRAINT "TrustSignal_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
