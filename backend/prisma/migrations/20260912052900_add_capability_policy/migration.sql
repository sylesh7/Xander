-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRule" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "actionType" TEXT,
    "minAmount" TEXT,
    "maxAmount" TEXT,
    "trustBands" TEXT[],
    "maxCoordinationRisk" DOUBLE PRECISION,
    "minBehaviorIntegrity" DOUBLE PRECISION,
    "requiresLiveAssurance" BOOLEAN,
    "effect" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "limitAmount" TEXT,
    "limitFrequency" INTEGER,
    "limitWindowSeconds" INTEGER,
    "capabilityTtlSeconds" INTEGER,

    CONSTRAINT "PolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capability" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "capabilityType" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "resourceScope" TEXT NOT NULL,
    "chainScope" INTEGER,
    "amountLimit" TEXT,
    "frequencyLimit" INTEGER,
    "frequencyWindowSeconds" INTEGER,
    "allowedTargets" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceDecisionId" TEXT,
    "assuranceLeaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityUsage" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "intentId" TEXT,
    "amount" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssuranceLease" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "worldCredentialRef" TEXT,
    "establishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastProvenAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sessionBinding" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssuranceLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Policy_version_key" ON "Policy"("version");

-- CreateIndex
CREATE INDEX "PolicyRule_policyId_idx" ON "PolicyRule"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRule_policyId_priority_key" ON "PolicyRule"("policyId", "priority");

-- CreateIndex
CREATE INDEX "Capability_actorId_status_expiresAt_idx" ON "Capability"("actorId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "Capability_actorId_actionType_idx" ON "Capability"("actorId", "actionType");

-- CreateIndex
CREATE INDEX "CapabilityUsage_capabilityId_createdAt_idx" ON "CapabilityUsage"("capabilityId", "createdAt");

-- CreateIndex
CREATE INDEX "AssuranceLease_actorId_status_expiresAt_idx" ON "AssuranceLease"("actorId", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "PolicyRule" ADD CONSTRAINT "PolicyRule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Capability" ADD CONSTRAINT "Capability_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityUsage" ADD CONSTRAINT "CapabilityUsage_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceLease" ADD CONSTRAINT "AssuranceLease_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
