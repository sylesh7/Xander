-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "secretHash" TEXT NOT NULL,
    "secretSalt" TEXT NOT NULL,
    "actorScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actionScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorSession" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userAgent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "OperatorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingAction" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "actorId" TEXT,
    "agentId" TEXT,
    "incidentId" TEXT,
    "intentId" TEXT,
    "summary" TEXT NOT NULL,
    "allowed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "bindingHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decision" TEXT,
    "decisionReason" TEXT,
    "limitAmount" TEXT,
    "workflowSignalled" BOOLEAN NOT NULL DEFAULT false,
    "requiresStepUp" BOOLEAN NOT NULL DEFAULT false,
    "stepUpProofId" TEXT,

    CONSTRAINT "PendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorAuditLog" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT,
    "sessionId" TEXT,
    "deviceId" TEXT,
    "action" TEXT NOT NULL,
    "subject" TEXT,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "nonce" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Operator_externalId_key" ON "Operator"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorSession_tokenHash_key" ON "OperatorSession"("tokenHash");

-- CreateIndex
CREATE INDEX "OperatorSession_operatorId_status_idx" ON "OperatorSession"("operatorId", "status");

-- CreateIndex
CREATE INDEX "OperatorSession_expiresAt_idx" ON "OperatorSession"("expiresAt");

-- CreateIndex
CREATE INDEX "PendingAction_status_expiresAt_idx" ON "PendingAction"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PendingAction_actorId_idx" ON "PendingAction"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorAuditLog_nonce_key" ON "OperatorAuditLog"("nonce");

-- CreateIndex
CREATE INDEX "OperatorAuditLog_operatorId_createdAt_idx" ON "OperatorAuditLog"("operatorId", "createdAt");

-- CreateIndex
CREATE INDEX "OperatorAuditLog_action_outcome_idx" ON "OperatorAuditLog"("action", "outcome");

-- AddForeignKey
ALTER TABLE "OperatorSession" ADD CONSTRAINT "OperatorSession_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorAuditLog" ADD CONSTRAINT "OperatorAuditLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
