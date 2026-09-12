# XANDER — BACKEND-SUGANTHAN
## Track: Evidence & Risk Engine (Phases 1–12 of 25)

**Read this first, every time you open this file:** this is one half of a two-person backend. The other half is `Backend-Sylesh.md` (Phases 13–25, Decision/Escalation/API track). **Section 0 below (Locked Product Spec, Shared Prisma Schema, Env Vars, Repo Layout) is byte-identical in both files on purpose** — it is the contract that lets the two of you build independently and wire together at the end without a merge nightmare. If you ever need to change something in Section 0, change it in both files in the same sitting, or tell Sylesh immediately — a schema drift between the two docs is the one thing that will actually block final wiring.

Every technical claim in this document — package names, endpoints, entity names, manifest shapes — was checked against live, current documentation (Sept 2026), not recalled from memory. Where something genuinely couldn't be pinned down, it's flagged as such and given a documented fallback, not a guess.

---

## 0. Shared contract (identical in Backend-Sylesh.md)

### 0.1 Locked product spec

> **Xander is a real-time adaptive Sybil firewall for token claims and DeFi incentives. It continuously builds provenance-backed behavioral evidence from The Graph's Token API, Standardized Subgraphs, and Substreams, normalizes it into a behavior graph, clusters coordinated wallets, and scores them using deterministic, explainable features with robust (median/MAD) statistics. Clusters — not individual wallets — are the unit of analysis. Suspicious clusters can be investigated by an AI agent through Subgraph MCP, but the AI never makes the enforcement decision. A policy engine decides the minimum assurance a claim needs: allow immediately, escalate to World Selfie Check for an additional liveness/uniqueness credential, or block. Every decision produces a reproducible Evidence Receipt — features, sources, deployment IDs, block numbers, and the exact policy version that made the call.**

This is now locked. Three teams' worth of independent review converged on it, and the strategic reasoning holds up against real evidence — most importantly, The Graph's own July 2026 retrospective on ETHGlobal Lisbon winners (`thegraph.com/blog/ethglobal-lisbon-2026-winners/`, confirmed live, published July 28, 2026) shows ten independent teams converging, unprompted, on exactly three things this spec already does: (1) a deployment registry mapping standardized schemas to protocol deployments instead of hand-coded adapters — `deeptrace`, `atlas`, `BookerBob`, and `Am I cooked` all built one, independently; (2) provenance and freshness treated as correctness, not decoration — `deeptrace` rejects any response whose deployment ID doesn't match a pinned value, `EQLTY` blocks a trade on stale data rather than acting on it, `atlas` health-checks sources before spending; (3) real-time streaming as a correctness requirement, not a performance nice-to-have — `atlas` moved off polling onto a Substreams gRPC subscription specifically because "a guard five minutes late is a preference for an app that displays and a bug for one that spends." Your architecture already does all three. Build it as specified below.

**Two corrections locked in from the review pass, both real and evidence-backed:**
- World Selfie Check does **not** hand you a "Sybil score" — that phrase never appears in World's own documentation. What's real and confirmed (from `world.org/solutions/selfie-check`, fetched directly): Selfie Check returns an anonymous proof plus a **medium-assurance uniqueness signal** via Anonymized Multi-Party Computation (AMPC) — explicitly one tier below Orb verification's "highest assurance" on World's own comparison table. Say "medium-assurance uniqueness signal," never "Sybil score," anywhere in your docs or pitch.
- The `selfieCheckLegacy` preset in `@worldcoin/idkit-core` is confirmed (via the SDK's own current docs source, checked directly) to sit under a **"legacy" credential group alongside `orbLegacy`, `secureDocumentLegacy`, and `documentLegacy`** — these correspond to the World ID 3.0-generation credential flow, distinct from the newer World ID 4.0 uniqueness/session proofs. It is also confirmed as **the only supported preset for invite-code (cross-device) mode today**, and is the real, currently-working integration path — use it. One thing worth knowing: World's own docs navigation has a hidden, not-yet-public page for a *native* (non-legacy) Selfie Check integration (`world-id/selfie-check/overview`) — that's coming, but isn't available now. Don't wait for it; build against `selfieCheckLegacy`.

### 0.2 Non-negotiable engineering rules

1. **No hardcoded protocol/deployment data.** Every DeFi protocol, chain, and risk weight is a row in a table, never a `switch` statement.
2. **No fabricated SDKs.** If a package name isn't confirmed in this doc or in the live docs, build a thin typed wrapper over the documented raw REST/GraphQL interface — that is a permanent solution, not a placeholder.
3. **Every risk decision carries provenance** — source, deployment, block, observed-at — full stop.
4. **Failure = `PENDING_REVIEW`, never a confident invented decision.** A stale or failed Graph query holds the claim, it never silently defaults to `ALLOW`.
5. **Deterministic core, AI at the edges.** The score comes from auditable arithmetic. The LLM investigates and explains; it never decides.
6. **Cluster is the unit of analysis, not the wallet.** A wallet's risk is inherited from its cluster.

### 0.3 Confirmed technology stack

| Layer | Technology | Status |
|---|---|---|
| Runtime | Node.js 20+, TypeScript | Standard |
| API framework | Express + `zod` | Standard (Sylesh's side owns the HTTP layer; you expose plain functions/modules) |
| Database | PostgreSQL + Prisma ORM | Confirmed — relational joins across wallets/clusters/evidence are the core query pattern |
| Cache/queue | Redis + BullMQ | Confirmed, standard |
| Graph — historical wallet data | Token API, REST, `https://token-api.thegraph.com/v1/...`, Bearer JWT | Confirmed — no dedicated Node SDK exists (checked twice); build the REST wrapper as the permanent solution |
| Graph — cross-protocol DeFi data | Standardized Subgraphs, GraphQL, query URL `https://gateway.thegraph.com/api/{GRAPH_GATEWAY_API_KEY}/subgraphs/id/{deploymentId}` | Confirmed — exact gateway pattern verified against a live thegraph.com docs code sample |
| Graph — Messari lending schema entities | `lendingProtocols, markets, accounts, positions, deposits, borrows, repays, withdraws, liquidates, flashloans, financialsDailySnapshots, marketDailySnapshots, usageMetricsDailySnapshots` | Confirmed — from The Graph's own blog post on this exact schema spanning 90+ lending protocols |
| Graph — real-time streaming | Substreams, Rust module compiled to WASM, real crates `substreams` (^0.7) and `substreams-ethereum` (^0.11) | Confirmed, real crates.io packages — **now P0**, not stretch, per the locked spec |
| Graph — Substreams → backend bridge | `substreams-sink-webhook` (Node/Bun) or `substreams-sink` (generic Node CLI) | Confirmed, real npm packages from pinax-network |
| Graph — provenance metadata | `_meta { block { number } hash deployment }` on every subgraph query | Confirmed |
| Config / env validation | `zod` parsing a typed `env.ts` | Standard |
| Testing | `vitest` + `supertest` | Standard |
| Observability | `pino` | Standard |

*(World ID, Subgraph MCP, Mastra, and the API framework live in Sylesh's Phase 13+ — full stack table repeated there too.)*

### 0.4 Shared Prisma schema — the single source of truth

Both of you write to and read from this schema. It lives at `db/prisma/schema.prisma` in the shared repo. **Whoever runs `prisma migrate dev` first "owns" the migration file for that change — coordinate in chat before altering a model the other person's phases depend on.**

```prisma
// db/prisma/schema.prisma

model DeploymentRegistryEntry {
  id            String   @id @default(cuid())
  protocol      String
  chain         String
  schemaFamily  String   // "lending-cdp" | "dex-amm" | "yield-aggregator" | ...
  deploymentId  String   // the Qm... id from Graph Explorer
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now())
}

model PolicyVersion {
  id          String   @id @default(cuid())
  version     String   @unique   // e.g. "1.0", "1.1" — bump manually, never overwrite
  weights     Json               // snapshot of RiskWeight rows at activation time
  thresholds  Json               // snapshot of RiskThreshold rows at activation time
  activatedAt DateTime @default(now())
  active      Boolean  @default(false) // exactly one row true at a time — enforce with a transaction, not a unique constraint (Postgres has no partial-unique-on-boolean without a filtered index; add one if you want DB-level enforcement: `@@unique([active])` won't work for "at most one true" — use a partial index in a raw migration if you want belt-and-suspenders)
}

model RiskWeight {
  id        String  @id @default(cuid())
  feature   String  @unique  // "FUNDING_CORRELATION", "TIMING_CORRELATION", ...
  weight    Float
  updatedAt DateTime @updatedAt
}

model RiskThreshold {
  id        String  @id @default(cuid())
  band      String  @unique  // "ALLOW" | "CHALLENGE" | "BLOCK"
  minScore  Float
  maxScore  Float
  updatedAt DateTime @updatedAt
}

model Wallet {
  address         String   @id
  firstSeenBlock  BigInt?
  createdAt       DateTime @default(now())
  cluster         Cluster? @relation(fields: [clusterId], references: [id])
  clusterId       String?
}

model Cluster {
  id          String   @id @default(cuid())
  confidence  String   // "LOW" | "MEDIUM" | "HIGH"
  score       Float
  wallets     Wallet[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model EvidenceEvent {
  id              String   @id @default(cuid())
  chain           String
  wallet          String
  counterparty    String?
  eventType       String   // "transfer" | "deposit" | "withdraw" | "borrow" | "repay" | "swap" | ...
  protocol        String?
  protocolType    String?  // schema family
  amount          String?  // string, never float — these are on-chain amounts
  timestamp       DateTime
  blockNumber     BigInt
  transactionHash String
  sourceType      String   // "token-api" | "standardized-subgraph" | "substreams"
  sourceId        String
  deploymentId    String?
  createdAt       DateTime @default(now())

  // Phase 5 idempotency. The spec suggests "transactionHash + eventType + wallet
  // (or similar composite)"; sourceId is included because those three alone
  // collide whenever one transaction carries two events of the same type for
  // the same wallet — a batched deposit into two markets, a multi-hop swap.
  // sourceId holds the SOURCE's own event key (`hash-logIndex` for subgraphs,
  // `txid-logIndex` for Token API), so it disambiguates without inventing a
  // logIndex column.
  @@unique([transactionHash, eventType, wallet, sourceId])
  @@index([wallet])
  @@index([blockNumber])
}

model RiskEvidence {
  id               String   @id @default(cuid())
  wallet           String
  clusterId        String?
  feature          String
  value            Float
  baseline         Float?
  confidence       String
  source           String
  sourceDeployment String?
  block            BigInt?
  observedAt       DateTime @default(now())
}

model Claim {
  id              String   @id @default(cuid())
  wallet          String
  campaignId      String
  riskDecision    String   // "ALLOW" | "CHALLENGE" | "BLOCK" | "PENDING_REVIEW"
  clusterId       String?
  policyVersion   String?  // the PolicyVersion.version active when this decision was made
  createdAt       DateTime @default(now())
  decidedAt       DateTime?

  @@unique([wallet, campaignId]) // idempotency — see Sylesh Phase 22
}

model VerificationChallenge {
  id               String   @id @default(cuid())
  claimId          String
  wallet           String
  // World ID nullifiers are 256-bit ints, returned as 0x-hex. Convert to
  // decimal before storing — Postgres has no native 256-bit int type.
  nullifier        Decimal? @db.Decimal(78, 0)
  rpId             String?
  status           String   // "ISSUED" | "PASSED" | "FAILED" | "EXPIRED"
  worldActionId    String
  signalHash       String
  createdAt        DateTime @default(now())
  resolvedAt       DateTime?

  @@unique([nullifier, worldActionId])
}

model EvidenceReceipt {
  id                String   @id @default(cuid())
  claimId           String   @unique
  wallet            String
  clusterId         String?
  decision          String
  riskScore         Float
  confidence        String
  features          Json     // [{ name, value }]
  sources           Json     // [{ type, deployment, block }]
  policyVersion     String
  requiredAssurance String?  // "SELFIE_CHECK" | null
  worldChallengeId  String?
  createdAt         DateTime @default(now())
}

// Added 2026-09-08 by SYLESH (Phase 15/22), migration `add_investigation`.
// PURELY ADDITIVE — no existing model changed, so nothing in Phases 1-12 can
// break on it; `prisma migrate deploy` is all that is needed on that side.
//
// Phase 15 still writes its RiskEvidence row (source: "mcp-investigation"), but
// RiskEvidence is a numeric feature row with no column for a narrative, a wallet
// list, or a tool-call trace — and Phase 22 requires GET /investigations/:id to
// serve a real result. `citations` holds the agent's ACTUAL tool-call trace,
// kept separate from its prose so an uncited report can be rejected rather than
// trusted (Section 0.2 rule 5: the AI investigates, it never decides).
model Investigation {
  id           String    @id @default(cuid())
  clusterId    String
  wallets      Json // string[] — the wallet set handed to the agent
  status       String // "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED"
  summary      String? // the agent's narrative
  citations    Json // [{ tool, args }] from the real tool-call trace
  toolCalls    Int       @default(0)
  model        String?
  finishReason String?
  error        String?
  createdAt    DateTime  @default(now())
  completedAt  DateTime?

  @@index([clusterId])
}

// Added 2026-09-12 (Xander V2 Phase 5, spec sections 5.4, 9, 10), migration
// `add_agent_liveness`. PURELY ADDITIVE — models Agent and LivenessChallenge,
// neither read nor written by any V1 path.
//
// An Agent is not an Actor; it HAS one, so its authority flows through that
// actor's capabilities (invariant 3.4 keeps wallet, human and agent distinct).
// LivenessChallenge stores no biometric material: a nonce, what was asked,
// whether it was satisfied, and the derived finger counts that justify the
// verdict. The landmark trace is verified and discarded.
//
// Indexes: Agent(actorId), Agent(status), Agent(ensName) UNIQUE,
// LivenessChallenge(actorId, status), LivenessChallenge(agentId),
// LivenessChallenge(nonce) UNIQUE.

// Added 2026-09-12 (Xander V2 Phase 3, spec sections 5.8, 7, 20), migration
// `add_capability_policy`. PURELY ADDITIVE — Policy, PolicyRule, Capability,
// CapabilityUsage and AssuranceLease. No V1 path reads or writes any of them.
//
// Authorization rules are ROWS, first match by ascending priority. Adding a
// rule is an INSERT, the same discipline rule 1 applies to protocols and
// weights. A null trust dimension never satisfies a rule threshold, so an
// unmeasurable actor cannot fall through to a permissive rule; an unmatched
// request defaults to REVIEW, never ALLOW.
//
// Definitions live in prisma/schema.prisma. Indexes: Capability(actorId,
// status, expiresAt), Capability(actorId, actionType), CapabilityUsage(
// capabilityId, createdAt), AssuranceLease(actorId, status, expiresAt),
// PolicyRule(policyId) and unique (policyId, priority).

// Added 2026-09-12 (Xander V2 Phase 2, spec sections 5.6, 6 and 21), migration
// `add_trust_context`. PURELY ADDITIVE — models TrustSnapshot and TrustSignal,
// both append-only, neither read nor written by any V1 path.
//
// Every trust dimension column is NULLABLE and NULL MEANS UNKNOWN, never zero.
// A 0 would be indistinguishable from "measured, and it came out clean" for a
// wallet nobody has any evidence on, which is precisely invariant 3.2's
// warning. The band derivation is ordered rather than weighted so a strong
// dimension can never average away a live coordination signal.
//
// Definitions live in prisma/schema.prisma with their rationale; not duplicated
// here to avoid drift. Indexes: TrustSnapshot(actorId, createdAt),
// TrustSignal(actorId, createdAt), TrustSignal(actorId, kind).

// Added 2026-09-12 (Xander V2 Phase 1, spec sections 5.1-5.10), migration
// `add_actor_intent_foundation`. PURELY ADDITIVE — five new models, no existing
// model, column, index or constraint changed, and no V1 code path reads or
// writes any of them.
//
// The reframing: V1 is `wallet -> score -> World -> claim`. V2 is
// `actor -> intent -> evidence -> trust -> policy -> capability`. These five
// models are the first two nouns. `/v2/*` is a parallel API surface; the Claim
// Gate keeps working exactly as before.
//
// NOT ADDED ON PURPOSE: the V2 spec's section 5.3 `Wallet` (with chainId and
// actorId). This repo's `Wallet` already exists, is keyed on address with no
// chainId, and the clustering and evidence paths run on it — rewriting it is
// exactly what "V2 is additive" forbids. The actor-to-wallet edge therefore
// lives only in `ActorIdentity`, so there is one authoritative link rather than
// two that can disagree.
//
// The full definitions live in prisma/schema.prisma (models Actor,
// ActorIdentity, Intent, AuthorizationDecision, ActionReceipt) with their
// rationale in comments; they are not duplicated here to avoid the two files
// drifting apart. Indexes added: ActorIdentity(kind, externalId) UNIQUE,
// Intent(actorId, status, expiresAt), Intent(idempotencyKey) UNIQUE,
// AuthorizationDecision(intentId), ActionReceipt(intentId), ActionReceipt(actorId).

// Added 2026-09-12 by SUGANTHAN (Xander V2 Phase 0, spec section 12.3),
// migration `add_known_funder_address`. PURELY ADDITIVE — no existing model
// changed, and nothing on Sylesh's track reads or writes it.
//
// Closes a promise Readme.md has made since day one and called "the single most
// important lesson" from the Arbitrum airdrop precedent, with no implementation
// behind it: FUNDING_CORRELATION treated a shared funder identically whether it
// was a private wallet or a Binance hot wallet. The extractor now scores
// labelled and unlabelled funders separately and takes
// `max(unlabelled, labelled x KNOWN_FUNDER_WEIGHT_MULTIPLIER)`, so a benign
// shared funder is down-weighted while a ring cannot launder itself by routing
// one extra transfer through an exchange.
//
// `chain` is a network slug, NOT the numeric chainId the V2 spec's field list
// names — it has to join against EvidenceEvent.chain, which is a slug.
// `source` and `confidence` are load-bearing: a funder label is an assertion by
// somebody, and a wrong one is a security hole in both directions, so the row
// records who said so. validFrom/validTo let a rotated hot wallet stop
// excusing new evidence without deleting the label a past decision was made
// under.
model KnownFunderAddress {
  id         String    @id @default(cuid())
  address    String
  chain      String
  label      String // "Binance 14", "Base: L1StandardBridge"
  category   String // EXCHANGE | BRIDGE | FAUCET | PROTOCOL_TREASURY | KNOWN_DISTRIBUTOR | OTHER
  source     String // provenance of the label — a URL or dataset name, never blank
  confidence String // "LOW" | "MEDIUM" | "HIGH"
  validFrom  DateTime  @default(now())
  validTo    DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  @@unique([chain, address])
}

// Phase 10.2/10.4. One row per (chain, moduleName) stream. The cursor is an
// OPAQUE string per the Substreams sink contract — never parsed, only stored
// and replayed. Persisted AFTER a batch's evidence is durably written, never
// before: if the process dies between those two writes, the block is
// reprocessed on restart rather than silently skipped. blockNumber is kept
// alongside the cursor purely for /health reporting (Phase 11) — the cursor,
// not this number, is what the stream actually resumes from.
model SubstreamsCursor {
  id          String   @id @default(cuid())
  chain       String
  moduleName  String
  cursor      String
  blockNumber BigInt
  updatedAt   DateTime @updatedAt

  @@unique([chain, moduleName])
}
```

### 0.5 Repo layout (shared repo — you both work in the same tree)

```text
xander-backend/
├── src/
│   ├── config/                       # SUGANTHAN Phase 2 — shared, don't duplicate
│   │   ├── env.ts
│   │   └── deployment-registry.ts
│   ├── db/prisma/schema.prisma       # SUGANTHAN Phase 2 — shared, Section 0.4 above
│   ├── graph/                        # SUGANTHAN — your track
│   │   ├── token-api/                # Phase 3
│   │   ├── standardized-subgraphs/   # Phase 4
│   │   ├── substreams/               # Phase 9–10
│   ├── evidence/                     # SUGANTHAN Phase 5
│   ├── behavior-graph/               # SUGANTHAN Phase 6
│   ├── risk/                         # SUGANTHAN Phase 7–8
│   ├── provenance/                   # SUGANTHAN Phase 11
│   ├── interfaces/
│   │   └── evidence-risk-api.ts      # SUGANTHAN Phase 12 — the seam, see below
│   ├── world/                        # SYLESH — their track, Phase 16–19
│   ├── mcp/                          # SYLESH — Phase 15
│   ├── cache/                        # SYLESH — Phase 14
│   ├── policy/                       # SYLESH — Phase 20–21
│   ├── claim/                        # SYLESH — Phase 22 (the HTTP layer)
│   └── server.ts                     # SYLESH owns this — it's the Express entrypoint
├── docs/
├── test/
├── .env.example
└── package.json
```

### 0.6 Environment variables you own (full list is in Sylesh's doc too)

```bash
# .env.example — your section. Sylesh's vars (World, MCP) are appended in their doc.

NODE_ENV=development
DATABASE_URL=postgresql://user:pass@localhost:5432/xander
REDIS_URL=redis://localhost:6379

GRAPH_MARKET_API_TOKEN=            # Phase 1 — Token API bearer JWT
TOKEN_API_BASE_URL=https://token-api.thegraph.com
GRAPH_GATEWAY_API_KEY=             # Phase 1 — used by Phase 4 (gateway URL) AND by Sylesh's Phase 15 (MCP)

ENABLE_SUBSTREAMS=true             # locked P0 — don't feature-flag this off
SUBSTREAMS_ENDPOINT=               # Phase 9 — Firehose provider endpoint (e.g. Pinax-hosted)
SUBSTREAMS_WEBHOOK_SECRET=         # Phase 10
```

---

## 1. Phase 1 — Access & credentials (Graph side) + shared local infra

Do this before writing code. You're doing this jointly with Sylesh on Day 1 — split it: you handle everything below, Sylesh handles the World side (their Phase 13).

| # | What to obtain | Where | Why it blocks you |
|---|---|---|---|
| 1.1 | The Graph Market account + API token (Authentication JWT) | `thegraph.com/docs/token-api/` → "Gain access" | Token API requires this bearer token on every request, no unauthenticated tier |
| 1.2 | A Gateway API key from Subgraph Studio | `thegraph.com/studio` | Powers both the Standardized Subgraphs query URL (Phase 4) and, on Sylesh's side, the Subgraph MCP connection |
| 1.3 | Standardized Subgraph deployment IDs for your 2–3 chosen protocols | Graph Explorer, `thegraph.com/explorer` — search by protocol name, copy the deployment ID (`Qm...`), never the display name | Wrong or stale deployment ID silently returns nothing useful |
| 1.4 | Local Postgres + Redis via Docker Compose | — | Both tracks need these running from day one |
| 1.5 | Decide Start Fresh vs. Continuity with ETHGlobal if any prior code is reused | Live ETHOnline 2026 prize page | Re-check the actual current wording — sponsor rules get edited during the event |

**Acceptance test:** `docker compose up` brings up Postgres + Redis; a `curl` with your Token API bearer token against `https://token-api.thegraph.com/v1/evm/balances?network=mainnet&address=<any real address>` returns real data, not a 401.

---

## 2. Phase 2 — Repo scaffold + shared schema + env config

**Build:**
- `npm init`, TypeScript strict mode, ESLint/Prettier.
- `src/config/env.ts`: `zod`-validated environment, single source of truth — no file anywhere else reads `process.env` directly.
- Write the full Prisma schema from **Section 0.4** exactly as shown — this is not "a starting point," it's the locked shape both tracks build against. Run the first migration.
- `docker-compose.yml` with `postgres:16` and `redis:7`.
- Seed script skeleton (`prisma/seed.ts`) — you'll populate it in Phase 12, but create the file now so Sylesh can add World-side seed data to the same script later without a merge conflict.

**Acceptance test:** `prisma migrate dev` runs clean against the schema in 0.4; `npm run dev` boots a bare Express server (even with zero routes) and `/health` returns `{ ok: true }`.

---

## 3. Phase 3 — Token API client (historical wallet evidence)

**Goal:** answer "who funded this wallet, when, how much, from how many sources, when did it first appear."

**Build:**
- `src/graph/token-api/client.ts`: a thin authenticated `fetch` wrapper. Base URL and bearer token from `env`, never inlined.
- Confirmed real endpoint shape:
  ```
  GET https://token-api.thegraph.com/v1/evm/balances?network=mainnet&address=0x...
  GET https://token-api.thegraph.com/v1/evm/transfers?network=mainnet&address=0x...
  GET https://token-api.thegraph.com/v1/evm/tokens?network=mainnet&contract=0x...
  Headers: Accept: application/json, Authorization: Bearer <token>
  ```
- `network` is one of The Graph's supported network IDs — load your supported list from config, never a hardcoded `switch`.
- **Confirmed: there is no official Token API Node/TypeScript SDK.** Two independent research passes found nothing beyond the raw REST docs. Build the wrapper above as the permanent answer, not a placeholder waiting for an SDK that doesn't exist.
- Feed every response through the Phase 5 normalizer immediately — nothing downstream touches a raw Token API shape.

**Acceptance test:** given a real mainnet address, `getTransfers(address)` returns a typed list and each item round-trips through the normalizer into an `EvidenceEvent` row with `sourceType: "token-api"`.

---

## 4. Phase 4 — Standardized Subgraphs client + Deployment Registry (first-class)

**Goal:** answer "has this wallet borrowed / supplied liquidity / farmed yield, and do other wallets share the exact same protocol path" — cross-protocol, without a custom adapter per protocol. **This is now a first-class component, not a nice-to-have** — it's the single pattern The Graph's own Lisbon-winner retrospective flagged as the biggest independent convergence across ten teams.

**Build:**
- `src/graph/standardized-subgraphs/deployment-registry.ts`: reads the `DeploymentRegistryEntry` table at startup and on a TTL refresh — **this is the only place "which protocols we support" lives.** Adding protocol #10 is an `INSERT`, never a code change — exactly the pattern `deeptrace`, `atlas`, `BookerBob`, and `Am I cooked` each independently built.
- `src/graph/standardized-subgraphs/client.ts`: a generic `graphql-request` client, query URL:
  ```
  https://gateway.thegraph.com/api/{GRAPH_GATEWAY_API_KEY}/subgraphs/id/{deploymentId}
  ```
  Confirmed exact pattern — build it directly.
- One query module per **schema family**, not per protocol. Confirmed real entity names for `queries/lending-cdp.ts` (the Messari standardized lending schema, spans Aave, Compound, MakerDAO, Spark, Venus and dozens more across Ethereum, Polygon, Arbitrum, Avalanche, BSC, Optimism, Base):
  ```
  lendingProtocols, markets, accounts, positions,
  deposits, borrows, repays, withdraws, liquidates, flashloans,
  financialsDailySnapshots, marketDailySnapshots, usageMetricsDailySnapshots
  ```
  For `dex-amm` and `yield-aggregator`, the same standardization pattern applies but wasn't independently entity-by-entity re-verified — pull exact names from the live Standardized Subgraphs docs page when you write those two modules; don't guess field names for those two families.
- Every query requests `_meta { block { number } deployment }` alongside entities — provenance (Phase 11) needs this on every fetch, not bolted on later. **This is exactly what `deeptrace` and `atlas` do — reject or flag anything where the pinned deployment doesn't match.**

**Acceptance test:** two different deployment IDs tagged with the same `schemaFamily` run through the same query function with no `if (protocol === 'aave')` branch anywhere.

---

## 5. Phase 5 — Evidence Normalizer

**Goal:** one internal shape (`EvidenceEvent`) that Token API, Standardized Subgraph, and Substreams data all become, so downstream code never knows which Graph product produced a fact.

**Build:**
- `src/evidence/normalizer.ts`: pure functions per source (`normalizeTokenApiTransfer`, `normalizeLendingEvent`, `normalizeSubstreamsEvent`).
- `src/evidence/repository.ts`: idempotent upsert by `transactionHash + eventType + wallet` (or similar composite) — re-fetching the same window twice must be a no-op, not a duplicate row.

**Acceptance test:** feed the same Token API response through twice; the second write is a no-op.

---

## 6. Phase 6 — Behavior Graph & Clustering

**Goal:** turn isolated `EvidenceEvent` rows into a graph of relationships, then group coordinated wallets. **Cluster is the unit of analysis — a single wallet's score is meaningless outside its cluster.**

**Build:**
- `src/behavior-graph/`: build a graph over the candidate wallet set (e.g. every wallet that interacted with a given campaign in the current window). For each pair, compute `FUNDING_CORRELATION` and `SHARED_COUNTERPARTY` (formulas in Phase 7); add an edge if either exceeds a configured `EDGE_THRESHOLD` (start at `0.5`).
- `src/behavior-graph/clustering.ts`: run union-find / connected components over those edges. Each component with `size >= MIN_CLUSTER_SIZE` (config, default `2`) becomes a `Cluster` row. This two-pass approach — pairwise edges first, then cluster-level re-scoring in Phase 8 — is what keeps the final score explainable instead of one opaque similarity number.

**Acceptance test:** a synthetic set of 5 wallets sharing a funder within a tight window forms one `Cluster` row; 5 unrelated wallets form none.

---

## 7. Phase 7 — Risk Engine: feature extractors

**Goal:** define, with real formulas, the five features that drive everything downstream. All knobs are config (a `risk_config` table or env), never inline numbers.

- **`FUNDING_CORRELATION`** — does this wallet set share a funder? Take each wallet's earliest inbound transfer(s) from Token API evidence (`FUNDING_LOOKBACK_HOPS`, start at `1` — the direct funder only; walking further back is a real graph traversal, don't reach for it until direct-funder correlation proves insufficient). Group wallets by shared funder within `FUNDING_WINDOW_HOURS` (default `24`). `value = (size of the largest shared-funder group − 1) / (total wallets − 1)`.
- **`TIMING_CORRELATION`** — `value = max(0, 1 − stddev_seconds(timestamps) / TIMING_NORMALIZATION_SECONDS)`, default `3600`.
- **`WALLET_AGE_SIMILARITY`** — same shape, applied to `firstSeenBlock` converted to approximate timestamp via average block time. `AGE_NORMALIZATION_BLOCKS` default `~50,000`.
- **`SHARED_COUNTERPARTY`** — average pairwise Jaccard similarity of distinct counterparty addresses each wallet has touched (`EvidenceEvent.counterparty`): `J = |Cᵢ ∩ Cⱼ| / |Cᵢ ∪ Cⱼ|`, averaged across all pairs.
- **`PROTOCOL_BEHAVIOR_SIMILARITY`** — normalized Longest Common Subsequence of ordered `eventType` sequences per wallet (from Phase 4 data): `LCS(seqᵢ, seqⱼ) / max(|seqᵢ|, |seqⱼ|)`, averaged across pairs.

**Acceptance test:** each extractor is a pure, independently unit-testable function `(walletSet, evidenceWindow) => { value, confidence, sourceEvidenceIds }`.

---

## 8. Phase 8 — Risk Engine: robust baselines, scoring, and policy bands

**Goal:** turn features into a defensible score, resistant to a contaminated campaign population.

**Build:**
1. **Robust statistics, not naive mean/std.** If most of a campaign's participants are coordinated attackers, a mean/std baseline normalizes the attack into looking "normal" — a real contamination problem. Use **median and MAD (median absolute deviation)** or percentile thresholds for any feature that's normalized against a campaign-level baseline, not mean/std. This is a genuine correctness fix, not a style preference — apply it anywhere Phase 6/7 compares a wallet against "the rest of the set."
2. **Cluster-level re-scoring** — once Phase 6 forms a cluster, recompute all five features **at the cluster level**, not just pairwise.
3. **Scoring** (`src/risk/scoring.ts`) — reads weights from `RiskWeight`, `score = Σ weightᵢ × featureᵢ`. Validate at seed time that weights sum to `1.0`, fail loudly if not. Seed weights (funding 25%, timing 15%, wallet-age 15%, shared-counterparty 15%, protocol-behavior 15%, 15% reserve) are **a configurable demo policy, not a validated model** — say exactly that in your own `RISK-MODEL.md`.
4. **Policy bands** — `RiskThreshold` table, seeded e.g. `ALLOW [0, 0.35)`, `CHALLENGE [0.35, 0.7)`, `BLOCK [0.7, 1.0]`. A judge asking "why 0.35?" gets a row, not a magic number.
5. **`PolicyVersion` snapshotting** — whenever `RiskWeight`/`RiskThreshold` are edited, write a new `PolicyVersion` row snapshotting the full weight/threshold set as JSON, set it `active: true`, flip the previous one to `false` in the same transaction. This is what makes an `EvidenceReceipt` (Sylesh Phase 21) reproducible months later even if you've since retuned the weights.

**Acceptance test:** two synthetic sets — one 5-wallet coordinated cluster funded from one address within 4 minutes, one 5-wallet unrelated set — score `CHALLENGE`+ and `ALLOW` respectively, each with a fully reconstructable evidence trail and a `policyVersion` attached.

---

## 9. Phase 9 — Substreams: the Rust module (now P0)

You've decided to build this for real, not as a stretch goal — the Lisbon retrospective (Section 0.1) is exactly why: `atlas` and `Pista` both treated real-time streaming as correctness, not decoration, and that's the same reason it belongs in this build.

**Build:**
- Scope narrowly: emit an `EntityChanges` stream for "new funding transfer" and "new claim/reward event" only. Don't reimplement the risk engine inside the module.
- Confirmed real scaffold:
  ```toml
  # Cargo.toml
  [package]
  name = "xander-substreams"
  version = "0.1.0"
  edition = "2021"

  [lib]
  crate-type = ["cdylib"]

  [dependencies]
  substreams = "0.7"            # confirmed real crate
  substreams-ethereum = "0.11"  # confirmed real crate
  prost = "0.11"

  [target.wasm32-unknown-unknown.dependencies]
  getrandom = { version = "0.2", features = ["custom"] }

  [profile.release]
  lto = true
  opt-level = 's'
  strip = "debuginfo"
  ```
  ```yaml
  # substreams.yaml
  specVersion: v0.1.0
  package:
    name: "xander_substreams"
    version: v0.1.0
  imports:
    entity: https://github.com/streamingfast/substreams-entity-change/releases/download/v0.2.1/substreams-entity-change-v0.2.1.spkg
  protobuf:
    files:
      - xander.proto
    importPaths:
      - ./proto
  binaries:
    default:
      type: wasm/rust-v1
      file: ./target/wasm32-unknown-unknown/release/xander_substreams.wasm
  modules:
    - name: map_funding_transfers
      kind: map
      inputs:
        - source: sf.ethereum.type.v2.Block
      output:
        type: proto:xander.v1.FundingTransfers
    - name: graph_out
      kind: map
      inputs:
        - map: map_funding_transfers
      output:
        type: proto:substreams.entity.v1.EntityChanges
  ```
  `map_funding_transfers` — filtering block transactions/logs for your target contracts — is genuinely new Rust you write; the crate names, manifest shape, and the `EntityChanges` output type your Node sink expects (Phase 10) are real and confirmed, not invented.

**Honest time note:** if neither of you has touched Rust/protobuf/WASM before, budget real days for this, not hours — the scaffold removes guesswork, it doesn't remove the learning curve.

**Acceptance test:** `substreams pack` produces a valid `.spkg`; `substreams run` against a small block range streams non-empty `FundingTransfers`.

---

## 10. Phase 10 — Substreams: Node bridge + risk-cache invalidation (the interface point with Sylesh)

**Build:**
1. Bridge with the confirmed real npm package `substreams-sink-webhook` (or `substreams-sink`) — point `--manifest` at your `.spkg`, `--substreams-endpoint` at a Firehose provider (confirm current URL, these are third-party-hosted and do move), `POST` each block's changes to `src/graph/substreams/webhook-receiver.ts`.
2. The webhook receiver verifies `SUBSTREAMS_WEBHOOK_SECRET`, persists the cursor (so a restart resumes instead of reprocessing), and feeds every event through the Phase 5 normalizer with `sourceType: "substreams"`.
3. **Reorg handling is not optional** — the sink protocol's "undo" signal for reorged-out blocks must roll back the corresponding `EvidenceEvent` rows.
4. **This is the seam with Sylesh's Phase 14 risk cache**: after persisting new evidence, publish an invalidation signal — the simplest real mechanism is a BullMQ job (`queue: 'risk-invalidation'`, payload `{ walletOrClusterId }`) enqueued from the webhook receiver. Sylesh's cache worker (Phase 14) consumes this queue and evicts/recomputes. Document the exact queue name and payload shape in `src/interfaces/evidence-risk-api.ts` (Phase 12) so this isn't tribal knowledge.

**Acceptance test:** kill and restart the sink mid-stream, confirm it resumes from the saved cursor; a new funding transfer through the sink visibly enqueues a `risk-invalidation` job.

---

## 11. Phase 11 — Provenance & freshness guarantees

**Goal:** never let a stale or failed Graph query produce a confident decision — the exact discipline `deeptrace`, `EQLTY`, and `atlas` each independently built.

**Build:**
- `src/provenance/freshness-guard.ts` — before any risk computation uses evidence, check the `_meta.block.number` captured at fetch time against current chain head. If lag exceeds a configured threshold, or a required deployment query failed outright, the caller gets `PENDING_REVIEW` back, not a score.
- Extend `/health` (owned by Sylesh's `server.ts`, but you own the data it reports) to include: Token API last-successful-call timestamp, each enabled deployment's block lag, Substreams cursor lag.

**Acceptance test:** point a deployment registry entry at a bad deployment ID; confirm anything depending on it resolves `PENDING_REVIEW`, never `ALLOW`.

---

## 12. Phase 12 — Testing, seed data, and the Suganthan → Sylesh interface

**Build:**
1. `prisma/seed.ts` — a clean-wallet scenario (score near `0`, resolves `ALLOW`) and a synthetic coordinated-cluster scenario (5 wallets, one funder, tight timing window, resolves `CHALLENGE`+). Sylesh will extend this same file with World-side seed data — don't overwrite it, append.
2. **`src/interfaces/evidence-risk-api.ts`** — this is the actual contract Sylesh's orchestrator (their Phase 20/22) calls into. Export exactly these functions, fully typed, with no side effects beyond what's documented:
   ```ts
   // What Sylesh's Policy Engine and Claim Gate call — nothing else in your
   // track should be imported directly from outside src/.

   export async function getOrComputeClusterRisk(walletAddress: string): Promise<{
     clusterId: string | null
     riskScore: number
     confidence: 'LOW' | 'MEDIUM' | 'HIGH'
     policyVersion: string
     features: Array<{ name: string; value: number }>
     sources: Array<{ type: string; deployment: string | null; block: string | null }>
     status: 'OK' | 'PENDING_REVIEW' // freshness-guard result — Sylesh must handle PENDING_REVIEW explicitly, never treat it as OK
   }>

   export async function refreshWalletEvidence(walletAddress: string): Promise<void>
   // Triggers Token API + Standardized Subgraph fetches for a wallet if evidence is stale.
   // Sylesh's claim orchestrator calls this before getOrComputeClusterRisk on a cache miss.
   ```
   Everything else in your `src/graph`, `src/evidence`, `src/behavior-graph`, `src/risk` folders is an implementation detail Sylesh's code never touches directly.
3. Write a short `docs/EVIDENCE-RISK-INTERFACE.md` documenting the BullMQ `risk-invalidation` queue name/payload (Phase 10) and the two functions above — this is what Sylesh reads instead of your source code.

**Acceptance test:** Sylesh can write `import { getOrComputeClusterRisk } from '../interfaces/evidence-risk-api'` in their orchestrator and get a fully-typed response without needing to understand anything inside your folders.

---

## Next: hand off to Backend-Sylesh.md

Phases 13–25 build the Decision, Escalation & API track on top of what you've built here. **Phase 25 in both documents is identical** — it's the joint wiring and end-to-end test plan you'll both run together once your Phase 12 interface and their Phase 24 consumption of it are both done.
