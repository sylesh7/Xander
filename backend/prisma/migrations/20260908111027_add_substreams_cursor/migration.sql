-- Phase 10.2/10.4: cursor persistence so a restart resumes a Substreams stream
-- instead of reprocessing from initialBlock. One row per (chain, moduleName).
CREATE TABLE "SubstreamsCursor" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "moduleName" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubstreamsCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubstreamsCursor_chain_moduleName_key" ON "SubstreamsCursor"("chain", "moduleName");
