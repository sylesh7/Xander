# Evidence & Risk Interface — Suganthan → Sylesh

**Required by** Backend-Suganthan.md Phase 12.3.
**Consumed by** Backend-Sylesh.md Phases 14, 20, 22, 24.

> Sylesh: read this file instead of Suganthan's source code. If you find yourself
> opening `src/graph`, `src/evidence`, `src/behavior-graph`, `src/risk` or
> `src/provenance`, stop — that's a conversation, not a workaround (Sylesh Phase 24).

---

## 1. The whole contract, in one place

There are exactly **three** things crossing the boundary. Nothing else.

| #   | Thing                             | Where                                                        |
| --- | --------------------------------- | ------------------------------------------------------------ |
| 1   | `getOrComputeClusterRisk(wallet)` | `src/interfaces/evidence-risk-api.ts`                        |
| 2   | `refreshWalletEvidence(wallet)`   | `src/interfaces/evidence-risk-api.ts`                        |
| 3   | BullMQ queue `risk-invalidation`  | published by Suganthan Phase 10, consumed by Sylesh Phase 14 |

Plus the shared Postgres schema, which both tracks read and write directly.

---

## 2. The two functions

```ts
import { getOrComputeClusterRisk, refreshWalletEvidence } from '../interfaces/evidence-risk-api.js'
```

### `getOrComputeClusterRisk(walletAddress: string): Promise<ClusterRisk>`

Returns the risk assessment for the **cluster** the wallet belongs to. The cluster
is the unit of analysis (Section 0.2 rule 6) — an unclustered wallet comes back
with `clusterId: null` and is scored on its own evidence.

```ts
interface ClusterRisk {
  clusterId: string | null
  riskScore: number // 0..1
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  policyVersion: string // put this straight onto the EvidenceReceipt
  features: Array<{ name: string; value: number }>
  sources: Array<{
    type: string // 'token-api' | 'standardized-subgraph' | 'substreams'
    deployment: string | null
    block: string | null // string — block numbers exceed MAX_SAFE_INTEGER
  }>
  status: 'OK' | 'PENDING_REVIEW'
}
```

### `refreshWalletEvidence(walletAddress: string): Promise<void>`

Triggers Token API + Standardized Subgraph fetches if the wallet's evidence is
stale. Call it before `getOrComputeClusterRisk` on a cache miss. Idempotent and
safe to call repeatedly — a fresh wallet is a no-op.

---

## 3. The one thing that will bite you: `PENDING_REVIEW`

**Branch on `status` before you look at `riskScore`.** Not after.

```ts
const risk = await getOrComputeClusterRisk(wallet)

if (risk.status === 'PENDING_REVIEW') {
  // Evidence is stale, or a required Graph query failed outright.
  // Section 0.2 rule 4: hold the claim. Never fall through to ALLOW.
  return { decision: 'PENDING_REVIEW' }
}

// only now is riskScore meaningful
const decision = bandFor(risk.riskScore)
```

When `status` is `PENDING_REVIEW`, `riskScore` is **0** — which lands in the
`ALLOW` band. So a missing status check does not fail loudly; it silently
approves exactly the claims the system was least sure about. This is the single
most damaging integration bug available in this codebase, and it appears in the
failure-injection matrix of both specs (Suganthan Phase 11, Sylesh Phase 23).

---

## 4. The BullMQ invalidation queue

Import the constants; do not retype the string on either side.

```ts
import {
  RISK_INVALIDATION_QUEUE, // 'risk-invalidation'
  type RiskInvalidationJob, // { walletOrClusterId: string }
} from '../interfaces/evidence-risk-api.js'
```

|                                 |                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Queue name**                  | `risk-invalidation`                                                                                                             |
| **Payload**                     | `{ walletOrClusterId: string }` — a `0x...` address **or** a `Cluster.id`                                                       |
| **Producer**                    | Suganthan's Substreams webhook receiver (Phase 10.4), after persisting new evidence                                             |
| **Consumer**                    | Sylesh's cache worker (Phase 14)                                                                                                |
| **Expected consumer behaviour** | evict `risk:cluster:<id>` / `risk:wallet:<addr>`, then `refreshWalletEvidence()` then `getOrComputeClusterRisk()` to repopulate |

Because the payload can be either kind of id, the consumer must handle both. A
`0x`-prefixed 42-character string is a wallet; anything else is a cluster id (cuid).

---

## 5. Current status — read this before you build against it

**The stub is gone. Both functions do real work, verified live.** Everything
underneath — Phases 3 through 11 — is real, and `getOrComputeClusterRisk` /
`refreshWalletEvidence` now call into it for real: real Postgres lookups, real
Token API calls, real Standardized Subgraph queries, real scoring against the
active `PolicyVersion`.

**`getOrComputeClusterRisk(wallet)`:**

1. Looks up the wallet's existing `Cluster` membership (read-only — see §6 for
   how a cluster actually gets formed).
2. Runs the Phase 11 freshness guard over that wallet set's evidence.
3. If not fresh, returns `status: 'PENDING_REVIEW'` immediately — no score is
   computed. This includes a wallet with **no evidence at all**, which is
   the case most likely to bite an integration: it is tempting to assume
   "unknown wallet" means "safe," and this deliberately refuses that
   assumption. There is a test named exactly for this
   (`THE MOST DANGEROUS CASE` in `test/evidence-risk-api.db.test.ts`).
4. Otherwise scores the cluster (or the lone wallet, if unclustered) and
   returns `status: 'OK'` with the real score, features, sources and
   `policyVersion`.
5. Any internal failure — no active policy, a database error, anything —
   also resolves `PENDING_REVIEW` rather than propagating an exception a
   caller might not catch. A thrown error must never be the thing standing
   between a caller and a silent `ALLOW`.

**`refreshWalletEvidence(wallet)`** now actually fetches: Token API inbound
transfers, plus that wallet's activity across every enabled Standardized
Subgraph deployment in every schema family (lending-cdp, dex-amm,
yield-aggregator), normalized and persisted idempotently. One deployment
failing does not abort the others — errors are collected and logged, not
thrown, so a rate-limited protocol doesn't take down evidence you could
otherwise have gotten.

Both fixture addresses still work, now as **real seeded data** rather than
hardcoded responses — exactly as promised when the stub shipped. They are
exported from `src/interfaces/stub-fixtures.ts` as `FIXTURE_CLEAN_WALLET` and
`FIXTURE_CLUSTERED_WALLET`; import the constants rather than pasting the
literals. `npm run db:seed` seeds `FIXTURE_CLEAN_WALLET` with clean,
uncorrelated evidence (resolves `ALLOW`) and `FIXTURE_CLUSTERED_WALLET` plus
four synthetic cluster-mates sharing a funder in a tight window (resolves
`BLOCK`, score ≈0.85) — and actually **persists the cluster**, so
`getOrComputeClusterRisk` on any of the five returns the same real
`clusterId` and the same score.

Verified live, 2026-09-08:

```
FIXTURE_CLEAN_WALLET      -> status OK,  riskScore 0,      clusterId null
FIXTURE_CLUSTERED_WALLET  -> status OK,  riskScore 0.8465, clusterId <real cuid>, BLOCK band
unknown wallet             -> status PENDING_REVIEW, riskScore 0 (never read this as ALLOW)
refreshWalletEvidence(vitalik.eth) -> 200 real events persisted, 0 errors
```

---

## 6. Clustering is not automatic — read this before wiring up claim intake

`getOrComputeClusterRisk(wallet)` **looks up** whatever cluster a prior
clustering pass already formed. It does not, and architecturally cannot, form
a _new_ cluster on the fly — it takes one wallet, not a campaign, and Phase 6's
clustering needs the full candidate set ("every wallet that interacted with a
given campaign in the current window"). Only your `Claim` table knows that set.

A third export exists for this — **additive**, not one of the two locked
functions above:

```ts
import { recomputeClusterForCandidates } from '../interfaces/evidence-risk-api.js'

// wallets = every distinct wallet that has claimed against this campaignId
const clusterIds: string[] = await recomputeClusterForCandidates(wallets)
```

Call it once per campaign, over that campaign's full wallet list, **before**
scoring individual claims — the natural point is claim intake (your Phase 22),
since only that code has the campaign context this function needs. Skipping
this step doesn't break anything: `getOrComputeClusterRisk` still returns a
correct, real score — it just scores each wallet alone (`clusterId: null`)
because no cluster has been computed yet. Whether that is acceptable depends
on your campaign's shape; for anything where coordinated claims are the actual
threat model, call this first.

---

## 7. What Sylesh needs from Suganthan, and when

| Sylesh needs                                         | To unblock                | Status                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evidence-risk-api.ts`, real behaviour               | Phases 14, 20, 22         | ✅ **Available — real, not stubbed.** Verified live, see §5                                                                                                                                                                             |
| `RISK_INVALIDATION_QUEUE` name + payload             | Phase 14 cache worker     | Available now                                                                                                                                                                                                                           |
| Migrated Postgres with all 11 models                 | Phases 20, 21, 22         | Available now                                                                                                                                                                                                                           |
| Redis running                                        | Phase 14                  | Available now                                                                                                                                                                                                                           |
| `GRAPH_GATEWAY_API_KEY`                              | Phase 15 (Subgraph MCP)   | ✅ Available — verified live, hand it over                                                                                                                                                                                              |
| Real risk scores                                     | Phase 24 integration test | ✅ Available — real scoring engine, not the stub, from Phase 8                                                                                                                                                                          |
| Live queue producer                                  | Phase 14 end-to-end test  | ✅ **Available — verified live.** `enqueueRiskInvalidation` fires from the real Substreams stream after every block with new evidence; confirmed against real Redis with `bull:risk-invalidation:*` populated during a live mainnet run |
| Seeded `RiskThreshold` / active `PolicyVersion` rows | Phase 20 policy bands     | ✅ Available — `PolicyVersion` `1.0` active in Postgres                                                                                                                                                                                 |

**Every item on this list is now available, including the seam itself.**
Phases 1–12 are complete: `getOrComputeClusterRisk` and `refreshWalletEvidence`
do real work, not stub responses. There is nothing left on this track blocking
Sylesh from building against real data end to end.

---

## 8. What Suganthan needs from Sylesh

| Suganthan needs                                                                            | For                                                                   | Status             |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------ |
| Confirmation the Phase 14 worker consumes `risk-invalidation` with the exact payload above | Phase 10.4 seam                                                       | ✅ **Confirmed.** Consumed with the exact `{ walletOrClusterId }` payload, both id forms handled. `test/invalidation-worker.db.test.ts` drives your real producer through the real queue into the real worker, so it breaks if either side drifts |
| `server.ts` ownership taken over                                                           | Phase 22 — it is still a placeholder right now                        | ✅ **Taken** (Phase 22). Claim routes, auth, rate limiting and zod validation mounted |
| Preserve `/health`'s `{ ok, provenance }` shape when you take ownership                    | Already extended (Phase 11) — DB-only, no network calls, safe to poll | ✅ Done on my side. **Preserved verbatim**, and left as the one unauthenticated route |
| World-side fixtures appended to `prisma/seed.ts`                                           | Phase 25 joint run                                                    | ✅ **Added** in `seedSylesh()`; your function untouched. Adds a CHALLENGE-band cluster (scores 0.43) plus claims/challenges in every lifecycle state |

**One schema change from my side:** new model `Investigation` (migration
`add_investigation`), purely additive — no existing model, column, index or
constraint touched, so no query on your side can break. Run
`prisma migrate deploy`. Rationale is in Section 0.4 of both specs and in
`docs/PROGRESS-SYLESH.md`.

---

## 9. Shared-file etiquette

These files are touched by both people. Append inside your own marked section;
do not reorder or rewrite the other person's.

| File                   | Rule                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prisma/schema.prisma` | **Locked.** Changing a model means editing Section 0.4 in _both_ markdown docs in the same sitting, and telling the other person _before_ running `prisma migrate dev`. Whoever migrates first owns that migration file. |
| `prisma/seed.ts`       | Two functions, `seedSuganthan()` and `seedSylesh()`. Stay in yours.                                                                                                                                                      |
| `.env.example`         | Two sections, clearly marked. Add new vars to `src/config/env.ts` too, or they will not exist at runtime.                                                                                                                |
| `src/config/env.ts`    | Sylesh's World/MCP vars are already declared as optional so this track boots without them — tighten them to required on your side when ready.                                                                            |
| `src/server.ts`        | Suganthan wrote the placeholder; **Sylesh owns it from Phase 22**. Preserve `/health`.                                                                                                                                   |

---

## 10. Running it

```bash
cd backend
cp .env.example .env      # fill in credentials as they arrive
npm install
npm run infra:up          # postgres:16 + redis:7
npm run db:migrate        # first run creates the schema
npm run db:seed
npm run dev               # http://localhost:3000/health -> { ok: true }
npm run typecheck && npm run lint && npm test
```

### Commands to verify each layer live, not from memory

```bash
npm run check:graph       # Token API + Standardized Subgraphs + Substreams
                           # endpoint resolution, all against real credentials
npm run check:verdict     # runs the real Phase 5-8 pipeline against real
                           # EvidenceEvent rows and prints an ALLOW/CHALLENGE/
                           # BLOCK verdict, not a fabricated one
npm run substreams:pack   # packs backend/substreams into a .spkg
npm run substreams:run    # runs the packed module against live Base Sepolia
curl -s localhost:3000/health | jq .provenance   # DB-only freshness snapshot
```

---

## 11. Standalone deliverable: the `xander` Subgraph Studio subgraph

Not part of the locked Suganthan → Sylesh seam above, and not required by
either spec — built on explicit request, as an additional, directly-queryable
Graph artifact separate from the Substreams pipeline in §1-10. **Sylesh does
not need this for anything in the interface contract; it exists so The
Graph's Subgraph Studio product is represented by a real, live, queryable
deployment for the demo, alongside Token API, Standardized Subgraphs and
Substreams.**

| Item                | Value                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| Location             | `xander-subgraph/` (repo root, **outside** `backend/` — its own npm project) |
| Network               | `base-sepolia` — matches the Substreams target (§9 above), not mainnet |
| Contract              | Base Sepolia USDC proxy, `0x036CbD53842c5426634e7929541eC2318f3dCF7e` — verified live: same EIP-1967 proxy bytecode as mainnet USDC, `symbol() == "USDC"` |
| Entities indexed      | `Transfer` (hand-added — the auto-fetched ABI was proxy-only, `AdminChanged`/`Upgraded`, no ERC-20 events at all), plus `AdminChanged`, `Upgraded` |
| `startBlock`          | Set a few hundred blocks behind head at each deploy, not genesis — syncing a live token from block 0 is impractical to observe in one session |
| Studio page           | `https://thegraph.com/studio/subgraph/xander`                        |
| Current query endpoint | `https://api.studio.thegraph.com/query/1758823/xander/v0.0.3`        |
| Status                | ✅ **Deployed, synced to head, verified live** — real testnet `Transfer` events returned, confirmed advancing across a live poll |

### Commands to rebuild / redeploy it

```bash
cd xander-subgraph
npm install
npx graph codegen
npx graph build
npx graph auth <deploy-key>                                          # once
npx graph deploy --node https://api.studio.thegraph.com/deploy/ -l vX.Y.Z xander
```

### Query it

```bash
curl -s -X POST https://api.studio.thegraph.com/query/1758823/xander/v0.0.3 \
  -H "Content-Type: application/json" \
  -d '{"query":"{ _meta { block { number } } transfers(first:5, orderBy: blockNumber, orderDirection: desc) { id from to value blockNumber } }"}'
```

### Two real fixes made after the first deploy

1. **No `startBlock` meant syncing from genesis.** The scaffolded manifest
   defaulted to block 0 against a live head 51M+ blocks in on mainnet — set an
   explicit near-head `startBlock` instead.
2. **The auto-fetched ABI had no `Transfer` event.** `graph init` fetches
   whatever ABI is *at* the given address, and USDC sits behind an EIP-1967
   proxy — the proxy's own ABI is `AdminChanged`/`Upgraded`/`admin`/etc, not
   the ERC-20 implementation. Added the standard, fixed
   `Transfer(address indexed,address indexed,uint256)` fragment by hand; the
   proxy still emits it via `delegatecall`, so indexing it at the proxy
   address is correct.
3. **Mainnet → Base Sepolia.** First deployed against Base mainnet; switched
   to Base Sepolia (`0x036CbD53...`) on request, to match the rest of the
   project, which already targets testnet only for Substreams.
