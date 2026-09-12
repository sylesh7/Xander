-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "agentUri" TEXT,
    "erc8004AgentId" TEXT,
    "worldAgentId" TEXT,
    "ensName" TEXT,
    "ensTokenId" TEXT,
    "worldChallengeId" TEXT,
    "assuranceLeaseId" TEXT,
    "configurationJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivenessChallenge" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "actorId" TEXT NOT NULL,
    "challengeType" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "nonce" TEXT NOT NULL,
    "sessionBinding" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "consumedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "signalJson" JSONB,
    "cvVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LivenessChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_ensName_key" ON "Agent"("ensName");

-- CreateIndex
CREATE INDEX "Agent_actorId_idx" ON "Agent"("actorId");

-- CreateIndex
CREATE INDEX "Agent_status_idx" ON "Agent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LivenessChallenge_nonce_key" ON "LivenessChallenge"("nonce");

-- CreateIndex
CREATE INDEX "LivenessChallenge_actorId_status_idx" ON "LivenessChallenge"("actorId", "status");

-- CreateIndex
CREATE INDEX "LivenessChallenge_agentId_idx" ON "LivenessChallenge"("agentId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivenessChallenge" ADD CONSTRAINT "LivenessChallenge_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
