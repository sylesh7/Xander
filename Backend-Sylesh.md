# XANDER — BACKEND-SYLESH
## Track: Decision, Escalation & API (Phases 13–25 of 25)

**Read this first, every time you open this file:** this is one half of a two-person backend. The other half is `Backend-Suganthan.md` (Phases 1–12, Evidence & Risk Engine track). **Section 0 below is byte-identical in both files on purpose** — it's the contract that lets the two of you build independently and wire together at the end. If Section 0 ever needs to change, change it in both files in the same sitting, or tell Suganthan immediately.

Every technical claim below — package names, endpoints, request/response shapes — was checked against live, current documentation (Sept 2026). Where something genuinely couldn't be pinned down, it's flagged, with a documented fallback, not a guess.

---

## 0. Shared contract (identical in Backend-Suganthan.md)

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
| API framework | Express + `zod` — **you own `server.ts` and the whole HTTP layer** | Standard |
| Database | PostgreSQL + Prisma ORM | Confirmed |
| Cache/queue | Redis + BullMQ | Confirmed, standard — you own the risk cache (Phase 14) and consume Suganthan's `risk-invalidation` queue |
| MCP client / agent framework | Mastra, `@mastra/mcp` (`MCPClient`) | Confirmed, current (npm shows 0.10.6+) |
| Graph — AI investigation endpoint | `https://subgraphs.mcp.thegraph.com/sse` (SSE, `Authorization: Bearer <Gateway API key>`) | Confirmed — from The Graph's own Cursor/Cline connection guides |
| Identity — World ID 4.0, Selfie Check (Beta) | `@worldcoin/idkit-core` (`4.x`), `IDKit.request`, `selfieCheckLegacy` preset, `signRequest` at `@worldcoin/idkit-core/signing` | Confirmed, current — full flow below |
| World backend verification | `POST https://developer.world.org/api/v4/verify/{rp_id}` — one endpoint, handles both 4.0 and legacy 3.0 proofs, forward-as-is | Confirmed against the live integration guide and API reference |
| Config / env validation | `zod` parsing a typed `env.ts` | Standard |
| Testing | `vitest` + `supertest` | Standard |
| Observability | `pino` | Standard |

*(Token API, Standardized Subgraphs, Substreams live in Suganthan's Phase 1–12 — full stack table repeated there too.)*

### 0.4 Shared Prisma schema — read this, don't rewrite it

The full schema lives in `Backend-Suganthan.md` Section 0.4 and in `db/prisma/schema.prisma` in the shared repo — it is not repeated in full here to avoid the two files silently drifting apart; **always check the actual `schema.prisma` file in the repo as the source of truth, not either markdown doc, once Phase 2 has run.** The models you write to most: `Claim`, `VerificationChallenge`, `EvidenceReceipt`, `PolicyVersion`. The models you only read: `Wallet`, `Cluster`, `RiskWeight`, `RiskThreshold` (Suganthan's track owns writes to these).

**Schema change log** (Section 0.4 is owned by `Backend-Suganthan.md`; this list exists so you are never surprised by a migration):
- *2026-09-07, Phase 5* — `EvidenceEvent` gained `@@unique([transactionHash, eventType, wallet, sourceId])`. Needed for the idempotent upsert Phase 5 requires; there was no unique key to upsert against. Affects a model your track only reads, so nothing on your side changes. Migration `add_evidence_event_unique`.
- *2026-09-08, Phase 10* — new model `SubstreamsCursor` (chain, moduleName, cursor, blockNumber). Required to satisfy Phase 10's own acceptance test ("kill and restart the sink mid-stream, confirm it resumes from the saved cursor") and there was nowhere to persist one. Suganthan-track-only; your side never reads or writes it. Migration `add_substreams_cursor`.
- *2026-09-08, Phase 15/22 — **yours**, and the only schema change this track makes* — new model `Investigation` (clusterId, wallets, status, summary, citations, toolCalls, model, finishReason, error, timestamps). Purely additive: no existing model, column, index or constraint changed, so nothing on Suganthan's side can break — they need only `prisma migrate deploy`. Needed because Phase 15 says to persist the agent's report as a `RiskEvidence` row (which this still does, `source: "mcp-investigation"`), but `RiskEvidence` is a numeric feature row with no column for a narrative, a wallet list, or a tool-call trace — and Phase 22 requires `GET /investigations/:id` to serve a real result. `citations` holds the agent's actual tool-call trace, stored separately from its prose so an uncited report can be rejected rather than trusted. Migration `add_investigation`.

- *2026-09-12, Xander V2 Phase 0 (spec section 12.3)* — new model `KnownFunderAddress` (address, chain, label, category, source, confidence, validFrom, validTo), unique on `(chain, address)`. Purely additive: no existing model, column, index or constraint changed, so nothing on your side can break — `prisma migrate deploy` is all that is needed. Suganthan-track-only; only `FUNDING_CORRELATION`'s option loader reads it. It closes the known-funder exclusion list `Readme.md` has promised since day one and called "the single most important lesson" from the Arbitrum precedent, but which had no implementation: a shared funder scored identically whether it was a private wallet or a Binance hot wallet. Your track sees exactly one behavioural consequence — a cluster co-funded by a *labelled* exchange/bridge now scores materially lower on that one feature, so some claims that previously landed in `CHALLENGE` will land in `ALLOW`. Migration `add_known_funder_address`.

- *2026-09-12, Xander V2 Phase 1 (spec sections 5.1-5.10)* — five new models: `Actor`, `ActorIdentity`, `Intent`, `AuthorizationDecision`, `ActionReceipt`. Purely additive; not one existing model, column, index or constraint changed. **Your claim flow is untouched and stays the compatibility surface.** The new `/v2/actors` and `/v2/intents` routes are a parallel path that READS your policy engine and the risk cache through their existing entry points (`decide`, `getRiskThroughCache`) and writes only V2 tables — a `/v2/intents` call never creates a `Claim`, a `VerificationChallenge` or an `EvidenceReceipt`, and there is a test asserting exactly that. V1's `EvidenceReceipt` is untouched; `ActionReceipt` is the additive V2 equivalent keyed on an intent. One mapping worth knowing: V1 `PENDING_REVIEW` becomes V2 `REVIEW`, never `ALLOW`. Migration `add_actor_intent_foundation`.

- *2026-09-12, Xander V2 Phase 2 (spec sections 5.6, 6, 21)* — two new models: `TrustSnapshot` and `TrustSignal`, both append-only, indexed on `(actorId, createdAt)`. Purely additive; nothing existing changed and your claim flow is untouched. Every trust dimension column is NULLABLE and null means UNKNOWN, never zero — a 0 would be read as "measured, and clean" for a wallet nobody has evidence on. `/v2/intents` decisions now populate `AuthorizationDecision.trustSnapshotId`, so a decision cites an immutable snapshot; the V1-derived result itself is unchanged in this phase. Migration `add_trust_context`.

One field to know cold: `VerificationChallenge.nullifier` is `Decimal @db.Decimal(78, 0)` — World ID nullifiers are 256-bit ints returned as `0x`-hex strings; convert to decimal before storing, Postgres has no native 256-bit int type.

### 0.5 Repo layout — your folders

```text
xander-backend/
├── src/
│   ├── graph/, evidence/, behavior-graph/, risk/, provenance/    # SUGANTHAN's track
│   ├── interfaces/
│   │   └── evidence-risk-api.ts      # SUGANTHAN Phase 12 — your only way into their track
│   ├── world/                        # YOU — Phase 16–19
│   │   ├── rp-signature.ts
│   │   ├── idkit-request-config.ts
│   │   ├── idkit-verify.ts
│   │   ├── wallet-binding.ts
│   │   └── replay-protection.ts
│   ├── mcp/                          # YOU — Phase 15
│   │   ├── client.ts
│   │   └── investigation-agent.ts
│   ├── cache/                        # YOU — Phase 14
│   │   └── risk-cache.ts
│   ├── policy/                       # YOU — Phase 20–21
│   │   ├── policy-engine.ts
│   │   └── evidence-receipt.ts
│   ├── claim/                        # YOU — Phase 22
│   │   ├── routes.ts
│   │   └── orchestrator.ts
│   └── server.ts                     # YOU own this — Express entrypoint
├── docs/
├── test/
└── .env.example
```

### 0.6 Environment variables you own (Suganthan's are in their doc)

```bash
# Appended to the shared .env.example — your section.

SUBGRAPH_MCP_URL=https://subgraphs.mcp.thegraph.com/sse   # confirmed endpoint, Phase 15

WORLD_APP_ID=                     # app_...  (backward-compat fallback only)
WORLD_RP_ID=                      # rp_...   (primary identifier)
WORLD_RP_SIGNING_KEY=             # secret — feeds signRequest(), server-side only, never sent to client
WORLD_ACTION_PREFIX=claim         # actions built as `${WORLD_ACTION_PREFIX}-${campaignId}`
WORLD_VERIFY_BASE_URL=https://developer.world.org

BACKEND_API_KEY=                  # Phase 22 — X-API-Key your own /screen-claim, /world/* routes require
```

---

## 13. Phase 13 — Access & credentials (World side) + MCP prerequisites

Do this on Day 1, in parallel with Suganthan's Phase 1 — this is the longest lead-time item in the whole project.

| # | What to obtain | Where | Why it blocks you |
|---|---|---|---|
| 13.1 | World Selfie Check **feature-flag access** | Email `developers@toolsforhumanity.com` requesting access, per `docs.world.org/world-id/credentials/11` | Access-gated — a human-approval step with **no published SLA**. Send this email before you write a line of code. |
| 13.2 | World Developer Portal app registration — `app_id`, `rp_id`, `signing_key` | `developer.world.org` (note the domain — moved from `developer.worldcoin.org`) | IDKit, RP signing, and verification all need these three; store `signing_key` as a secret, never in git |
| 13.3 | World's dev-testing tool | `simulator.worldcoin.org`, `environment: "staging"` — confirmed real, current dev-testing path from the live IDKit integrate guide. There's also an older Sandbox app distributed via TestFlight/private Play testing (`docs.world.org/world-id/sandbox/testing-selfie-check`) — **check whether these are the same testing path described two ways, or two different ones, before you plan around TestFlight lead time you might not actually need.** Ten minutes of checking here can save real friction later. |
| 13.4 | A Gateway API key from Subgraph Studio | Same key Suganthan obtains in their Phase 1 (`GRAPH_GATEWAY_API_KEY`) — reuse it for Phase 15's MCP connection, or mint a second scoped key | Powers the Subgraph MCP `Authorization: Bearer` header |

**Acceptance test:** the Selfie Check access-request email is sent, `app_id`/`rp_id`/`signing_key` exist in your local `.env` (never committed), and you've confirmed which of simulator vs. sandbox is your real Day-1 testing path.

---

## 14. Phase 14 — Risk Cache (the interface point with Suganthan's Phase 10)

**Goal:** claim latency shouldn't depend on a live Graph query chain every time. Normal users get an instant lookup; only suspicious cases trigger the expensive path.

**Build:**
- `src/cache/risk-cache.ts` — Redis-backed, key convention `risk:cluster:<clusterId>` and `risk:wallet:<address>` (for wallets not yet clustered), TTL as a safety net (e.g. 1 hour) plus **explicit invalidation**.
- **Consume Suganthan's `risk-invalidation` BullMQ queue** (documented in their `docs/EVIDENCE-RISK-INTERFACE.md`, Phase 12): a worker that, on receiving `{ walletOrClusterId }`, evicts the corresponding cache key and calls `refreshWalletEvidence()` + `getOrComputeClusterRisk()` from their `interfaces/evidence-risk-api.ts` to recompute and repopulate.
- Cache-miss path: call `getOrComputeClusterRisk(wallet)` directly, cache the result.

**Acceptance test:** a cache hit for a known wallet returns in single-digit milliseconds; a new funding transfer flowing through Suganthan's Substreams sink (their Phase 10) visibly invalidates and repopulates the corresponding cache entry within one BullMQ job cycle.

---

## 15. Phase 15 — Subgraph MCP investigation agent

**Goal:** when the risk engine flags a cluster, an agent investigates it — inspects schemas, runs follow-up queries, produces an explanation — without you hand-coding every possible question.

**Build:**
1. `npm install @mastra/mcp@latest` — confirmed real, current.
2. `src/mcp/client.ts`:
   ```ts
   import { MCPClient } from '@mastra/mcp'
   import { env } from '../config/env'

   export const subgraphMcpClient = new MCPClient({
     id: 'xander-subgraph-mcp',
     servers: {
       subgraphMcp: {
         url: new URL('https://subgraphs.mcp.thegraph.com/sse'), // confirmed endpoint
         requestInit: {
           headers: { Authorization: `Bearer ${env.GRAPH_GATEWAY_API_KEY}` },
         },
       },
     },
   })
   ```
   `@mastra/mcp`'s `MCPClient` connects to a `url`-based remote server natively (negotiates Streamable HTTP, falling back to the legacy SSE this endpoint uses) — no proxy process needed, unlike the `mcp-remote` proxy shown in The Graph's Cursor/Cline docs (those are for editor integrations, not backend code).
3. `src/mcp/investigation-agent.ts` — a Mastra `Agent` whose `tools` come from `await subgraphMcpClient.getTools()`. System instructions scope the investigation: give it the flagged `clusterId` and wallet list, and an explicit narrow mandate — "using only the Subgraph MCP tools available, determine which standardized schemas these wallets share activity in, and summarize the shared behavioral path; do not speculate beyond the query results." Cap tool-call budget (`maxSteps`) so an investigation can't run unbounded.
4. Persist the agent's report as a `RiskEvidence` row (`source: "mcp-investigation"`) via Suganthan's evidence repository — never a free-floating chat message. **The AI investigates; it does not touch `Claim.riskDecision`.**

**Acceptance test:** trigger an investigation for a seeded flagged cluster; the output cites a specific deployment/schema it actually queried, not a generic restatement of the risk score.

---

## 16. Phase 16 — World: RP signature (the step easiest to miss)

**Goal:** before a client can even open IDKit, your backend has to sign the request. This is real, confirmed, and wasn't in the original project spec at all — miss it and IDKit simply won't open.

```ts
// src/world/rp-signature.ts
import { signRequest } from '@worldcoin/idkit-core/signing'
import { env } from '../config/env'

export function generateRpSignature(action: string) {
  // Never call this anywhere but the backend — signing_key must never
  // reach the client. IDKit's own docs are explicit about this.
  return signRequest({ signingKeyHex: env.WORLD_RP_SIGNING_KEY, action })
  // -> { sig, nonce, createdAt, expiresAt }
}
```
Expose as `POST /world/rp-signature` (body: `{ action }`) — the client fetches this before it can build a valid IDKit request at all.

**Acceptance test:** `POST /world/rp-signature` with a valid action string returns `{ sig, nonce, created_at, expires_at }`.

---

## 17. Phase 17 — World: IDKit request contract

Not backend-run code, but the contract you hand the frontend team:
- `action` — a stable, descriptive string scoped to the campaign, pattern `claim-<campaignId>` (matching World's own `"claim-airdrop-2026"`-style examples).
- Request the **`selfieCheckLegacy`** preset from `@worldcoin/idkit-core` specifically — not the generic `orbLegacy`/`proof_of_human` preset. Confirmed real usage: `IDKit.request(...).preset(selfieCheckLegacy({ signal }))`.
- **`signal`** is the wallet-binding mechanism (Phase 19) — set it to the claim's wallet address.
- Document exactly this in your API contract for the frontend, since you (Sylesh) are the natural owner of the API surface the frontend calls.

---

## 18. Phase 18 — World: backend verification

**Never verify client-side** — this is IDKit's own explicit warning and a real security requirement.

```ts
// POST /world/verify body: { rp_id, idkitResponse, claimId }
const response = await fetch(
  `https://developer.world.org/api/v4/verify/${rpId}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(idkitResponse), // forward as-is — no field remapping
  },
)
```
Confirmed directly from the live `docs.world.org/world-id/idkit/integrate` page: forward the IDKit result exactly as received. One endpoint handles both World ID 4.0 and legacy 3.0 proofs — the confirmed API reference states it explicitly ("Verifies World ID 4.0 proofs and legacy 3.0 proofs... Use `rp_id` when possible; `app_id` is still accepted for backward compatibility"). **Do not use `verifyCloudProof` from `@worldcoin/minikit-js`** — documented as deprecated in favor of calling `/api/v4/verify/{rp_id}` directly.

**Acceptance test:** a valid Sandbox/simulator proof verifies successfully; a tampered payload is rejected by World's own endpoint, not by your own ad-hoc validation.

---

## 19. Phase 19 — World: wallet binding + nullifier/replay protection (first-class, not a footnote)

This is explicitly elevated to core architecture, not buried in a security appendix — a Sybil firewall whose own verification step can be replayed isn't a Sybil firewall.

- **Wallet binding**: the `signal` set in Phase 17 is echoed back inside the proof as `signal_hash`. Re-derive the expected hash from the claim's wallet address server-side and compare — a valid proof for wallet A's signal must be rejected if presented against wallet B's claim. Documented as the backend's job, not the Developer Portal's.
- **Replay protection**: every proof carries a `nullifier` — same person + same app + same action always produces the same one. Convert the returned `0x`-hex nullifier to decimal, store in `VerificationChallenge.nullifier` (`Decimal @db.Decimal(78,0)`), enforce uniqueness on `(nullifier, action)`. The Developer Portal only confirms cryptographic validity — checking it hasn't been used before is explicitly your job.
- **Uniqueness signal ≠ replay protection** — worth being precise about, since they're easy to conflate: Selfie Check's medium-assurance uniqueness signal (Section 0.1) is a *separate* World-side mechanism from the nullifier you're storing here. The nullifier stops the *same proof* being reused for the *same action*; the uniqueness signal is World's own claim about whether *this person* has been seen before, independent of your app. Don't build logic assuming the uniqueness signal is literally the nullifier — confirm the exact response field for it in `docs.world.org/api-reference/developer-portal/verify` before your Policy Engine (Phase 20) tries to weight it as an input.

**Acceptance test:** a valid proof for wallet A is rejected when replayed against wallet B's claim; an already-used `(nullifier, action)` pair is rejected on a second attempt.

---

## 20. Phase 20 — Policy Engine (adaptive assurance)

**Goal:** the score doesn't decide anything by itself — policy decides the *minimum assurance required*.

**Build:**
- `src/policy/policy-engine.ts` — calls `getOrComputeClusterRisk(wallet)` from Suganthan's interface. Explicitly handle the `status: 'PENDING_REVIEW'` case first — never treat it as a normal score.
- Reads the active `PolicyVersion`'s snapshotted thresholds (or falls back to live `RiskThreshold` rows if you haven't wired `PolicyVersion` activation yet) and maps score → `ALLOW` / `CHALLENGE` / `BLOCK`.
- On `CHALLENGE`, issue a `VerificationChallenge` (`worldActionId = ${WORLD_ACTION_PREFIX}-${campaignId}`) and set `requiredAssurance: "SELFIE_CHECK"`.
- Only call into World when policy returns `CHALLENGE` — a `LOW` risk wallet should never see a Selfie Check prompt. This is the entire "adaptive" thesis; don't let it leak into an "always verify" flow.
- Respect the **90-day validity window** documented for Selfie Check specifically — a challenge older than that isn't reusable as "still verified"; re-issue it.

**Acceptance test:** feeding the two Phase 8 synthetic scenarios (clean wallet, coordinated cluster) through the Policy Engine produces `ALLOW` (no World call at all) and `CHALLENGE` (issues a `VerificationChallenge`) respectively.

---

## 21. Phase 21 — Evidence Receipt

**Goal:** every decision is reproducible — this is the concrete artifact `deeptrace`'s and `EQLTY`'s provenance discipline (Section 0.1) turns into for this product.

**Build:**
- `src/policy/evidence-receipt.ts` — on every finalized `Claim`, write an `EvidenceReceipt` row: `features` (the exact feature values from Suganthan's `getOrComputeClusterRisk`), `sources` (deployment + block per source), `policyVersion` (the exact `PolicyVersion.version` active at decision time — this is why Phase 8's snapshotting matters: the receipt stays reproducible even after weights are retuned later), `requiredAssurance`, and the resolved `worldChallengeId` if one was issued.
- `GET /receipts/:id` (Phase 22) serves this back — this is what a judge or protocol operator opens to answer "why was this wallet challenged."

**Acceptance test:** every `Claim` produced in the Phase 20 acceptance test has a corresponding `EvidenceReceipt` row, and fetching it reconstructs the full decision chain without hitting the Graph or World again.

---

## 22. Phase 22 — Claim Gate API surface + operational concerns

**The locked endpoint surface:**

| Endpoint | Purpose |
|---|---|
| `POST /screen-claim` | Fast claim risk decision — body `{ wallet, campaignId }`, response `{ decision, clusterId, riskScore, requiredAssurance, evidenceReceiptId }` |
| `POST /world/rp-signature` | Phase 16 — must be called before the client opens IDKit |
| `POST /world/verify` | Phase 18 — body `{ rp_id, idkitResponse, claimId }` |
| `POST /world/challenge` | Re-issue a challenge for an existing claim if the previous one expired (past the 90-day window or simply timed out) — not the initial issuance, which happens inside `/screen-claim` |
| `POST /claim/finalize` | Finalizes the decision after World verification resolves — updates `Claim.riskDecision` from pending `CHALLENGE` to final `ALLOW`/`BLOCK` |
| `GET /clusters/:id` | Cluster summary |
| `GET /clusters/:id/evidence` | Detailed Graph evidence for a cluster |
| `GET /wallets/:address/risk` | Current wallet risk (reads through the Phase 14 cache) |
| `POST /investigations` | Start an MCP investigation — body `{ clusterId }` |
| `GET /investigations/:id` | Investigation result |
| `GET /receipts/:id` | Evidence Receipt |
| `GET /campaigns/:id` | Campaign-level metrics |

**Operational concerns — real gaps, not nice-to-haves:**
- **Auth.** `POST /screen-claim` and the `/world/*` routes trigger real, quota-bound upstream calls. A single shared `X-API-Key` header checked against `env.BACKEND_API_KEY` in Express middleware is enough for a hackathon backend — don't build OAuth, but don't leave it open either.
- **Rate limiting.** `express-rate-limit` (the standard, most-installed Express rate-limit middleware) on `POST /screen-claim` and `POST /world/*` specifically.
- **Concurrency / idempotency.** Two simultaneous `POST /screen-claim` calls for the same `{wallet, campaignId}` is a real race — the `@@unique([wallet, campaignId])` constraint on `Claim` (Section 0.4) turns this into a database-enforced rule. Wrap the create-or-fetch step in `prisma.claim.upsert(...)` (or catch the unique-constraint violation and re-fetch), never a check-then-insert.
- **Request/response validation.** `zod` schemas next to every route so malformed bodies are rejected before reaching the orchestrator.

**Acceptance test:** two concurrent `POST /screen-claim` calls for the same wallet+campaign produce exactly one `Claim` and one `VerificationChallenge`, not two; an unauthenticated request to any route above is rejected before it reaches the orchestrator.

---

## 23. Phase 23 — Observability, testing, failure hardening (your half)

**Failure-injection matrix, on top of what Suganthan tests on their side:**

| Failure | Expected behavior |
|---|---|
| Suganthan's evidence-risk API returns `PENDING_REVIEW` | Policy Engine holds the claim, never defaults to `ALLOW` |
| World verify endpoint times out | Challenge stays `ISSUED`, retry with backoff, never silently `ALLOW` |
| Duplicate claim submission | Idempotent — returns the existing `Claim` |
| Replayed World proof / reused nullifier | Rejected (Phase 19 acceptance test) |
| Wrong-wallet signal on a valid proof | Rejected (Phase 19 acceptance test) |
| MCP investigation tool-call runaway | Bounded by `maxSteps`, partial evidence saved on timeout |
| Database write failure mid-orchestration | Whole claim-decision transaction rolls back, no half-written `Claim` |
| Redis cache unavailable | Falls through to a direct `getOrComputeClusterRisk` call, degraded but correct, not a crash |

`vitest` + `supertest` for the API layer; extend Suganthan's `prisma/seed.ts` with your World-side fixtures rather than writing a second seed file.

---

## 24. Phase 24 — Integration wiring: consuming Suganthan's track

**Build:**
- Import only from `src/interfaces/evidence-risk-api.ts` — never reach into `src/graph`, `src/evidence`, `src/behavior-graph`, or `src/risk` directly. If you find yourself needing something that interface doesn't expose, that's a conversation with Suganthan, not a workaround.
- Confirm your Phase 14 cache worker's BullMQ consumer matches the exact queue name and payload shape documented in their `docs/EVIDENCE-RISK-INTERFACE.md`.
- Run both tracks together locally for the first time here — this is the actual "first wire," before the joint Phase 25 below.

**Acceptance test:** with both tracks running, a `POST /screen-claim` for a wallet with no cached risk triggers `refreshWalletEvidence()` → `getOrComputeClusterRisk()` on Suganthan's side, populates your cache, and returns a decision — one real request touching both halves of the system end to end.

---

## 25. Phase 25 — Joint wiring, end-to-end test, and frontend handoff

*(Identical in both documents — do this together, in the same room/call, not separately.)*

**Joint wiring checklist:**
1. Both tracks running against the same Postgres/Redis, `prisma/seed.ts` merged (Suganthan's clean-wallet + cluster fixtures, Sylesh's World-side fixtures) and re-seeded clean.
2. Run the full synthetic path end to end: seed → `POST /screen-claim` (clean wallet) → `ALLOW`, no World call → `GET /receipts/:id` reconstructs the full chain.
3. Run the full escalation path: seed → `POST /screen-claim` (coordinated cluster) → `CHALLENGE` → `POST /world/rp-signature` → simulator/Sandbox proof → `POST /world/verify` → `POST /claim/finalize` → `GET /receipts/:id` shows the complete Graph-evidence-to-World-verification chain.
4. Kill Suganthan's Substreams sink mid-stream, confirm cursor resume; confirm a new funding transfer through it correctly invalidates and repopulates Sylesh's risk cache.
5. Run the full Phase 12/23 failure-injection matrices together, back to back, and fix anything that surfaces at the seam rather than inside either individual track.

**Frontend handoff contract** — freeze this before frontend work starts:
- `POST /screen-claim`, `POST /world/rp-signature`, `POST /world/verify`, `POST /claim/finalize`, `GET /receipts/:id`, `GET /clusters/:id`, `GET /clusters/:id/evidence` are the routes frontend calls.
- The RP-signature call must happen *before* IDKit opens — make sure whoever builds the client knows this ordering; it's the single most common place to get the World flow wrong.
- `GET /receipts/:id` is what powers any "why was this wallet flagged" evidence UI — its shape (Phase 21) is the contract, don't let frontend improvise around it.

**Documentation index (both of you should have these bookmarked):**
- The Graph: `thegraph.com/docs/token-api/`, `.../subgraphs/existing-subgraphs/standard-subgraphs`, `.../subgraphs/querying/graphql-api/`, `thegraph.com/substreams/`, `.../ai-suite/subgraph-mcp/introduction`, `thegraph.com/blog/ethglobal-lisbon-2026-winners/`
- World: `docs.world.org/world-id/credentials/11`, `.../world-id/idkit/integrate`, `.../world-id/idkit/signatures`, `.../world-id/idkit/verification-flows`, `.../api-reference/developer-portal/verify`, `.../world-id/sandbox/testing-selfie-check`, `world.org/solutions/selfie-check`
- Mastra: `mastra.ai/docs/mcp/overview`, `npmjs.com/package/@mastra/mcp`
- ETHGlobal: live ETHOnline 2026 prize page — re-check it, sponsor tracks get edited during the event itself

**What's still genuinely open, not resolved by more research:**
1. Whether World's uniqueness signal is a threshold-able numeric value or a boolean — confirm against the real verify response before Phase 20 tries to weight it.
2. Sandbox app vs. `simulator.worldcoin.org` — reconcile in Phase 13, not on demo day.
3. `dex-amm`/`yield-aggregator` exact entity names — Suganthan's Phase 4, pull from live docs when those two query modules get written.
4. Selfie Check's access-gate turnaround time has no published SLA — it's why Phase 13.1 is a Day 1 action, not a Day 5 one.

None of these block starting today.
