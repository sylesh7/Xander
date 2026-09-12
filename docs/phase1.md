# Phase 1 — Actor + Intent foundation

**Status:** Complete
**Date:** 2026-09-12
**Spec:** `Xander/xander-v2-backend.md` §33 Phase 1, domain model §5.1–5.10, API §24
**Goal:** Move from wallet-centric request handling to actor/action semantics.

**Done when:** *"A claim can be represented as an Intent and linked to an Actor without changing the existing claim flow."* — met, and asserted literally by a test.

---

## 1. The reframing

V1 understands one sentence: `wallet → score → World → claim`. Phase 1 replaces the two nouns at the front.

```
V1:   wallet ──────────────────────────► claim decision
V2:   actor ──► intent ──► evidence ──► policy ──► decision ──► receipt
```

An **Actor** is whatever is acting — human, wallet, agent or organisation. A **wallet is not an actor**; it is one *identity* an actor holds. An **Intent** is a requested action recorded *before* it is authorized, so there is a durable row naming what was asked, which decision answered it, and what receipt it produced.

That distinction is what later phases hang off: trust attaches to an actor (Phase 2), capabilities are scoped to an actor+action pair (Phase 3), and Temporal workflows resume against an intent row (Phase 4).

---

## 2. What was built

### 2.1 Five models (migration `add_actor_intent_foundation`)

| Model | Purpose |
|---|---|
| `Actor` | The logical entity acting. `actorType` ∈ HUMAN / WALLET / AGENT / ORGANIZATION |
| `ActorIdentity` | One evidence-source link per row. Unique on `(kind, externalId)` |
| `Intent` | The requested action, recorded before authorization. Unique on `idempotencyKey` |
| `AuthorizationDecision` | The answer plus full lineage — evidence, policy version, trust figures |
| `ActionReceipt` | V1's Evidence Receipt pattern extended to any action, pinned by two hashes |

Purely additive. Not one V1 model, column, index or constraint changed.

### 2.2 Four routes (`src/v2/routes.ts`)

```
POST /v2/actors        GET /v2/actors/:id
POST /v2/intents       GET /v2/intents/:id
```

Mounted *alongside* the V1 Claim Gate, never in front of it. Auth, rate limiting and zod validation live inside the router so a route added later cannot silently skip them — same discipline as the V1 router.

### 2.3 Module layout (spec §25)

```
src/actor/    actor-types.ts, actor-resolver.ts, actor-service.ts
src/intent/   intent-types.ts, intent-validator.ts, intent-service.ts
src/v2/       routes.ts
```

---

## 3. Decisions that mattered

### 3.1 The one mapping that must not be wrong

V1 returns `ALLOW | CHALLENGE | BLOCK | PENDING_REVIEW`. V2's outcome set is `ALLOW | LIMIT | CHALLENGE | REVIEW | BLOCK`. The map is total, with **no default branch**, so adding a V1 decision later fails to compile rather than falling through to something permissive:

```
ALLOW          → ALLOW
CHALLENGE      → CHALLENGE
BLOCK          → BLOCK
PENDING_REVIEW → REVIEW        ← never ALLOW
```

Both specs call treating `PENDING_REVIEW` as OK *"the single most damaging integration bug available in this codebase"*. It means the evidence was stale or a Graph query failed; mapping it to ALLOW would turn that into a confident authorization built on nothing. There is a test named in shouting caps for exactly this, and it's verified live.

`LIMIT` is unreachable in Phase 1 — attenuation needs the capability engine from Phase 3. It exists in the type and column so neither has to change later.

### 3.2 No `Wallet` rewrite

Spec §5.3 describes a `Wallet` with `chainId` and `actorId`. V1 **already owns** a `Wallet` model, keyed on `address`, with no chainId, and the clustering and evidence paths run on it. Rewriting it is precisely what invariant 3.8 ("V2 is additive") forbids.

So the actor↔wallet edge lives in `ActorIdentity` **alone**. One authoritative link instead of two that can silently disagree.

### 3.3 Race-safety is a requirement, not a nicety

Two concurrent intents for the same new wallet must resolve to **one** Actor. Two actors owning one wallet makes "who is acting?" unanswerable and splits that wallet's trust history in half.

The pattern is read → create-and-catch → re-read, the same one V1 arrived at for `Claim` after a concurrency test caught a check-then-insert race. A transaction alone would not fix it: under READ COMMITTED the losing writer still sees no row and still tries to insert. Only the unique constraint makes the outcome deterministic; the catch turns the loser's error into the winner's row.

Both races are tested with genuinely concurrent requests (`Promise.all`), not sequential ones.

### 3.4 Idempotency is opt-in

`idempotencyKey` is caller-supplied and optional — the way it works in any payments API. Supply it and a retried network call replays the original decision rather than producing a second, possibly different, authorization. Omit it and each request is its own intent.

### 3.5 Ordering inside `authorize()`

Expiry and actor status are checked **before** any risk lookup. Both are absolute and cheap, and an expired or frozen actor's intent should not burn upstream Graph quota to reach a foregone answer.

An actor with no wallet identity resolves `REVIEW`, not `ALLOW` — invariant 3.2, absence of evidence is not low risk.

### 3.6 Receipts pin what they were built from

Two sha256 hashes: `evidenceSnapshotHash` over the sorted evidence lineage, `decisionPayloadHash` over the decision itself. Evidence ids are sorted before hashing because their order is a query artefact, not a fact — an unsorted hash would report tampering every time Postgres returned the same rows in a different order.

`executionStatus` is `NOT_EXECUTED` and Phase 1 never moves it. Section 18.2: nothing may be reported as executed-as-authorized until an enforcement adapter confirms it, and Phase 1 has no enforcement.

### 3.7 Trust figures stored on the decision

Mid-build I caught my own bug: `getIntent` was returning `riskScore: 0` regardless of the real score, because the score wasn't persisted anywhere. Returning 0 for a decision actually made at 0.85 is actively misleading.

`riskScore`, `clusterId` and `confidence` are now columns on `AuthorizationDecision`, documented as the Phase-1 stand-in for `TrustSnapshot`. Invariant 3.6 requires a decision to record the trust state it rested on — a decision that cannot say what produced it is not reconstructable. Phase 2 moves these into `TrustSnapshot` and populates `trustSnapshotId`.

### 3.8 ENS added as a forward hook

`ActorIdentity.kind` includes `ENS`, beyond the spec's §5.2 list, added **before the first migration** so an ENS name is first-class rather than an `ALTER TABLE` later.

Nothing resolves ENS yet. It is the natural carrier for the agent-as-namespace model — an agent as a subname whose *parent* is its human operator makes `AGENT_BACKED_BY` an on-chain fact instead of a database claim. Phase 5 builds it, against contracts verified at the time, not from memory.

---

## 4. Honest limitation: evidence lineage is source-level

`AuthorizationDecision.evidenceIds` holds descriptors like `standardized-subgraph:QmXxx@25957368`, not `EvidenceEvent` row ids.

The locked Suganthan→Sylesh interface exposes provenance (`{type, deployment, block}`) but **not** the underlying evidence row ids, and reaching around it with a deep import is what the ownership rule forbids. Row-level lineage needs the interface to expose it, which is a conversation with that track's owner rather than something to fake here.

Carried to Phase 2, which needs real evidence ids for `TrustSnapshot` anyway.

---

## 5. Test defect found — again, by me, again about parallelism

The "does not touch the V1 claim flow" test originally counted **global** `Claim` rows before and after. It passed alone and failed in the full suite, because `claim-api.db.test.ts` runs in parallel and creates real Claims at the same moment.

A global before/after count is not a valid assertion in a parallel suite. Rewritten to scope every assertion to this run's own `resourceId`. That is the second time a test of mine has failed this way (the Phase 0 seed-refresh test aged shared fixtures) — the pattern to avoid is any assertion over global state.

---

## 6. Verification

### 6.1 Test suite

```
typecheck   clean
lint        clean
tests       375 passed | 5 skipped | 0 failed   (380 total, 29 files)
            stable across 3 consecutive runs
```

Up from Phase 0's 330 → **+45 tests**. Still zero `vi.mock()` in the whole test directory.

- `test/intent-validator.test.ts` — 17 pure tests (hashing, canonical JSON, expiry)
- `test/v2-actor-intent.db.test.ts` — 28 tests against real Postgres over real HTTP

### 6.2 Live HTTP, real server, real Graph

All four decision paths through `POST /v2/intents`:

| Wallet | Result | Reason code | Score | Assurance |
|---|---|---|---|---|
| Clean fixture | `ALLOW` | RISK_WITHIN_ALLOW_BAND | 0 | — |
| Challenge-band cluster | `CHALLENGE` | RISK_REQUIRES_ASSURANCE | 0.43 | SELFIE_CHECK |
| Coordinated ring | `BLOCK` | RISK_IN_BLOCK_BAND | 0.8465 | — |
| Random unused wallet | `REVIEW` | EVIDENCE_NOT_FRESH | 0 | — |

Every one produced an `ActionReceipt`.

### 6.3 Coexistence proven

With `/v2` handling four intents, the V1 gate was called directly and returned `ALLOW` with a real `claimId`. Claim rows created by the V2 campaign: **0**.

---

## 7. Files changed

**New**
```
backend/src/actor/actor-types.ts        types, address normalisation
backend/src/actor/actor-resolver.ts     race-safe find-or-create
backend/src/actor/actor-service.ts      create/read actors
backend/src/intent/intent-types.ts      action types, results, reason codes
backend/src/intent/intent-validator.ts  pure hashing + expiry
backend/src/intent/intent-service.ts    the authorization flow
backend/src/v2/routes.ts                4 routes + scoped error middleware
backend/test/intent-validator.test.ts   17 pure tests
backend/test/v2-actor-intent.db.test.ts 28 integration tests
backend/prisma/migrations/…_add_actor_intent_foundation/
```

**Modified**
```
backend/prisma/schema.prisma   5 models
backend/src/config/env.ts      INTENT_DEFAULT_TTL_SECONDS
backend/src/server.ts          mounts v2Router alongside apiRouter
Backend-Suganthan.md           Section 0.4 log
Backend-Sylesh.md              Section 0.4 log
```

`claim/middleware.ts` was deliberately **not** touched — V2 has its own router-scoped error middleware, so a V1-owned file doesn't change every time V2 adds an error type.

---

## 8. Carried into Phase 2

1. **Evidence lineage is source-level** (§4). Phase 2's `TrustSnapshot` needs row-level ids; may require extending the locked interface.
2. **`riskScore`/`clusterId`/`confidence` live on `AuthorizationDecision`** as a stand-in. Phase 2 moves them into `TrustSnapshot` and sets `trustSnapshotId`.
3. **`LIMIT` is still unreachable** until Phase 3's capability engine.
4. **`ActorRelationship` not built** — it's Phase 2 (spec §5.5), along with the actor-level relationship pipeline.
5. **ENS hook is in place**, nothing resolves it yet.
