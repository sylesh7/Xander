-- CreateTable
CREATE TABLE "DeploymentRegistryEntry" (
    "id" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "schemaFamily" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentRegistryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "thresholds" JSONB NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskWeight" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskWeight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskThreshold" (
    "id" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "minScore" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "address" TEXT NOT NULL,
    "firstSeenBlock" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clusterId" TEXT,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "Cluster" (
    "id" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceEvent" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "counterparty" TEXT,
    "eventType" TEXT NOT NULL,
    "protocol" TEXT,
    "protocolType" TEXT,
    "amount" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "deploymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEvidence" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "clusterId" TEXT,
    "feature" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "baseline" DOUBLE PRECISION,
    "confidence" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceDeployment" TEXT,
    "block" BIGINT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "riskDecision" TEXT NOT NULL,
    "clusterId" TEXT,
    "policyVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationChallenge" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "nullifier" DECIMAL(78,0),
    "rpId" TEXT,
    "status" TEXT NOT NULL,
    "worldActionId" TEXT NOT NULL,
    "signalHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "VerificationChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceReceipt" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "clusterId" TEXT,
    "decision" TEXT NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "confidence" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "requiredAssurance" TEXT,
    "worldChallengeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_version_key" ON "PolicyVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "RiskWeight_feature_key" ON "RiskWeight"("feature");

-- CreateIndex
CREATE UNIQUE INDEX "RiskThreshold_band_key" ON "RiskThreshold"("band");

-- CreateIndex
CREATE INDEX "EvidenceEvent_wallet_idx" ON "EvidenceEvent"("wallet");

-- CreateIndex
CREATE INDEX "EvidenceEvent_blockNumber_idx" ON "EvidenceEvent"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_wallet_campaignId_key" ON "Claim"("wallet", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationChallenge_nullifier_worldActionId_key" ON "VerificationChallenge"("nullifier", "worldActionId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceReceipt_claimId_key" ON "EvidenceReceipt"("claimId");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
