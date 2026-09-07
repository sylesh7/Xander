-- Phase 5 idempotency: the composite key persistEvidenceEvents upserts against.
-- sourceId is included because (transactionHash, eventType, wallet) alone
-- collides when one transaction carries two events of the same type for the
-- same wallet — a batched deposit into two markets, a multi-hop swap.
CREATE UNIQUE INDEX "EvidenceEvent_transactionHash_eventType_wallet_sourceId_key" ON "EvidenceEvent"("transactionHash", "eventType", "wallet", "sourceId");
