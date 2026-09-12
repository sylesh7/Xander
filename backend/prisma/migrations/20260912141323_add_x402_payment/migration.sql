-- CreateTable
CREATE TABLE "X402Payment" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "intentId" TEXT,
    "receiptId" TEXT,
    "resource" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "payTo" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "payer" TEXT,
    "status" TEXT NOT NULL,
    "nonce" TEXT,
    "transaction" TEXT,
    "errorReason" TEXT,
    "trustBand" TEXT,
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "X402Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "X402Payment_nonce_key" ON "X402Payment"("nonce");

-- CreateIndex
CREATE INDEX "X402Payment_actorId_createdAt_idx" ON "X402Payment"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "X402Payment_status_idx" ON "X402Payment"("status");

-- AddForeignKey
ALTER TABLE "X402Payment" ADD CONSTRAINT "X402Payment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
