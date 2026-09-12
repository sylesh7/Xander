-- CreateTable
CREATE TABLE "Actor" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActorIdentity" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActorIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "chainId" INTEGER,
    "targetAddress" TEXT,
    "amount" TEXT,
    "asset" TEXT,
    "protocol" TEXT,
    "parametersHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorizationDecision" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "trustSnapshotId" TEXT,
    "policyId" TEXT,
    "policyVersion" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reasonSummary" TEXT NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "requiredAssurance" TEXT,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "clusterId" TEXT,
    "confidence" TEXT NOT NULL,
    "capabilityId" TEXT,
    "workflowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorizationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionReceipt" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "trustSnapshotId" TEXT,
    "evidenceSnapshotHash" TEXT NOT NULL,
    "decisionPayloadHash" TEXT NOT NULL,
    "executionStatus" TEXT NOT NULL DEFAULT 'NOT_EXECUTED',
    "executionTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Actor_actorType_status_idx" ON "Actor"("actorType", "status");

-- CreateIndex
CREATE INDEX "ActorIdentity_actorId_idx" ON "ActorIdentity"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "ActorIdentity_kind_externalId_key" ON "ActorIdentity"("kind", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Intent_idempotencyKey_key" ON "Intent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Intent_actorId_status_expiresAt_idx" ON "Intent"("actorId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthorizationDecision_intentId_idx" ON "AuthorizationDecision"("intentId");

-- CreateIndex
CREATE INDEX "ActionReceipt_intentId_idx" ON "ActionReceipt"("intentId");

-- CreateIndex
CREATE INDEX "ActionReceipt_actorId_idx" ON "ActionReceipt"("actorId");

-- AddForeignKey
ALTER TABLE "ActorIdentity" ADD CONSTRAINT "ActorIdentity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intent" ADD CONSTRAINT "Intent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorizationDecision" ADD CONSTRAINT "AuthorizationDecision_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionReceipt" ADD CONSTRAINT "ActionReceipt_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionReceipt" ADD CONSTRAINT "ActionReceipt_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AuthorizationDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
