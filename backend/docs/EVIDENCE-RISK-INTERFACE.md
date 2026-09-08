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

**`getOrComputeClusterRisk` and `refreshWalletEvidence` are typed stubs today.**
The **signatures and the queue contract above are final** — build against them
now. The bodies land across Phases 3–11.

Stub behaviour:

| Input                                        | Returns                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `0x0000000000000000000000000000000000000c1e` | `status: 'OK'`, `riskScore: 0.04`, `clusterId: null` — exercises your **ALLOW** path                         |
| `0x00000000000000000000000000000000000c1057` | `status: 'OK'`, `riskScore: 0.72`, `clusterId: 'stub-cluster-001'` — exercises your **CHALLENGE/BLOCK** path |
| anything else                                | `status: 'PENDING_REVIEW'` — exercises your **hold** path                                                    |

Both fixture addresses are exported from `src/interfaces/stub-fixtures.ts` as
`FIXTURE_CLEAN_WALLET` and `FIXTURE_CLUSTERED_WALLET`, and Phase 12 seeds the
same addresses for real — so tests written now keep passing after the stub is
deleted. Import the constants rather than pasting the literals.

`refreshWalletEvidence` is currently a no-op that logs a warning.

---

## 6. What Sylesh needs from Suganthan, and when

| Sylesh needs                                         | To unblock                | Status                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evidence-risk-api.ts` signatures                    | Phases 14, 20, 22         | Available now (stubbed)                                                                                                                                                                                                                 |
| `RISK_INVALIDATION_QUEUE` name + payload             | Phase 14 cache worker     | Available now                                                                                                                                                                                                                           |
| Migrated Postgres with all 11 models                 | Phases 20, 21, 22         | Available now                                                                                                                                                                                                                           |
| Redis running                                        | Phase 14                  | Available now                                                                                                                                                                                                                           |
| `GRAPH_GATEWAY_API_KEY`                              | Phase 15 (Subgraph MCP)   | ✅ Available — verified live, hand it over                                                                                                                                                                                              |
| Real risk scores                                     | Phase 24 integration test | ✅ Available — real scoring engine, not the stub, from Phase 8                                                                                                                                                                          |
| Live queue producer                                  | Phase 14 end-to-end test  | ✅ **Available — verified live.** `enqueueRiskInvalidation` fires from the real Substreams stream after every block with new evidence; confirmed against real Redis with `bull:risk-invalidation:*` populated during a live mainnet run |
| Seeded `RiskThreshold` / active `PolicyVersion` rows | Phase 20 policy bands     | ✅ Available — `PolicyVersion` `1.0` active in Postgres                                                                                                                                                                                 |

**Every item on this list is now available.** The remaining gap is Phase 12:
`getOrComputeClusterRisk`/`refreshWalletEvidence` are still the typed stub —
everything underneath them (Phases 3–11) is real and live, but the seam
Sylesh actually imports from has not been swapped over yet.
Everything else Sylesh needs in order to _start_ is already in place.

---

## 7. What Suganthan needs from Sylesh

| Suganthan needs                                                                            | For                                              | Status  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------- |
| Confirmation the Phase 14 worker consumes `risk-invalidation` with the exact payload above | Phase 10.4 seam                                  | Pending |
| `server.ts` ownership taken over                                                           | Phase 22 — it is a Phase 2 placeholder right now | Pending |
| `/health` kept alive and extended                                                          | Phase 11 reports provenance data through it      | Pending |
| World-side fixtures appended to `prisma/seed.ts`                                           | Phase 25 joint run                               | Pending |

---

## 8. Shared-file etiquette

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

## 9. Running it

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
