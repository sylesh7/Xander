-- Backend-Sylesh.md Phase 15 / Phase 22 — the Subgraph MCP investigation record.
--
-- ADDITIVE ONLY. No existing table or column is touched, so nothing in
-- Suganthan's Phase 1-12 track can break on this migration. Logged in Section
-- 0.4 of both markdown specs.
--
-- Phase 15 still writes its RiskEvidence row (source: 'mcp-investigation') as
-- specified; this table holds what RiskEvidence has no column for — the
-- narrative, the wallet set, and the real tool-call trace that
-- GET /investigations/:id serves.

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "wallets" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "citations" JSONB NOT NULL,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "finishReason" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Investigation_clusterId_idx" ON "Investigation"("clusterId");
