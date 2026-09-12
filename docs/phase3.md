# Phase 3 — Capability + Policy

**Status:** Complete
**Date:** 2026-09-12
**Spec:** `Xander/xander-v2-backend.md` §33 Phase 3, capabilities §5.8/§7, policy §20
**Goal:** Turn trust into actionable authorization.

**Done when:** *"The same actor can receive different capabilities for different actions."* — met, and proven live.

---

## 1. What changed

Through Phase 2, trust was **recorded but inert** — results still came from V1's policy engine. Phase 3 makes it authoritative and introduces the outcome V1 could never express:

```
CLAIM  50 USDC  → ALLOW      → GRANT
TRADE  5000 USDC → LIMIT     → ATTENUATED_GRANT, capped at 500 USDC / 20 per day
BORROW 50000 USDC → CHALLENGE → no capability at all
```

One actor. Three actions. Three answers. That's §7.2's own example running against real evidence.

---

## 2. Rules are rows, not code

`Policy` + `PolicyRule` tables, 18 seeded rules, **first match by ascending priority wins**. Adding a rule is an `INSERT` — the same discipline rule 1 already applies to protocols and risk weights. A rule nobody can inspect without reading TypeScript isn't an auditable policy, and `AuthorizationDecision.policyId` now points at the exact ruleset that produced a decision.

Deliberately a **fixed condition schema, not an expression DSL**. A DSL needs a parser, and a parser needs its own security review. Every condition this product actually has is a comparison.

Ordering *is* the policy — hard stops at 10–29, high-value actions at 30–49, banded trading at 40s, claims at 60s, catch-alls at 90+. Read the table top to bottom and you've read the authorization model.

### Cedar was not adopted

§20.3 says use Cedar *"only if it cleanly replaces or strengthens"* the engine. It doesn't here — every condition is a comparison against a trust vector we compute ourselves, so a WASM policy runtime would buy a dependency and no expressiveness. The native evaluator sits behind the `PolicyEvaluator` interface exactly as §20.3 requires, so swapping it later is a one-file change and nothing else imports Cedar types.

---

## 3. Three places this fails closed

1. **No rule matched → REVIEW.** An action nobody wrote a rule for is an action nobody authorised. A permissive default would make every gap in the ruleset a silent opening — and gaps are exactly what a new action type creates.
2. **Unrecognised rule effect → REVIEW.** A misconfigured rule must not be permissive.
3. **`PENDING_REVIEW` short-circuits before policy runs at all.** It's now a branch, not a lookup-table entry — because since Phase 3 the evaluator produces the result, and a table entry would have left it as one input a permissive rule could out-rank.

### And the subtle one: a null dimension never satisfies a threshold

If a rule says `maxCoordinationRisk: 0.3` and coordination risk is **unknown**, the rule does **not** match. Without that, an unmeasurable actor satisfies every upper-bound rule and falls straight through to the most permissive one — the cold-start hole reopening inside policy. Same for `minBehaviorIntegrity`, and for amount bounds when no amount was supplied.

---

## 4. Assurance as a rotating lease

`AssuranceLease` landed here rather than Phase 5, per the direction change:

```
World Selfie Check  → ESTABLISHES the lease
Active liveness     → ROTATES it
Expiry              → suspends the capabilities that depended on it
```

A capability carrying an `assuranceLeaseId` is denied with `ASSURANCE_LEASE_EXPIRED` the moment its lease lapses — tested by moving a lease's expiry into the past and re-checking. Lease TTL is a function of trust band (config): 24h at `VERIFIED_LOW` down to 0 at `CRITICAL`.

Nothing establishes a lease until Phase 5, so rules requiring live assurance correctly **CHALLENGE** today rather than silently passing. No biometric material is stored — a credential reference and a rotating nonce, per §3.7/§28.

Building it now cost a model and one field; retrofitting it into a live capability table in Phase 5 would have cost a migration and a backfill.

---

## 5. Capabilities are enforced, not decorative

`checkCapability` verifies liveness → assurance lease → amount → target → frequency, and every denial names a **specific** reason. "Denied" with no reason is unactionable for whoever has to explain it.

Frequency limits count real `CapabilityUsage` rows rather than a counter column, so two concurrent exercises can't lose an increment to a read-modify-write race. Revocation and suspension are **status transitions, not deletes** — a deleted row can't explain why something that used to work stopped.

---

## 6. A real policy bug the regression caught

The first ruleset made the clean fixture wallet resolve **CHALLENGE** instead of **ALLOW**.

Cause: rule 60 (`CLAIM ≤ 100 USDC, coordinationRisk < 0.3`) requires an *amount*, and a claim without one can't match it. The clean wallet bands `UNCERTAIN` (thin history), so it fell through to the catch-all challenge.

That's a genuine regression of the product's core vertical — a low-risk claim escalating purely for lack of wallet age, which V1 never did. Fixed with rule 63: a claim from a **measurably** low-coordination actor is allowed regardless of amount. It still requires a *measured* value, so an unmeasurable actor cannot reach it.

Worth being explicit: **the Phase 1 test caught this, not a Phase 3 test.** Testing Phase 3 alone would have shipped it.

---

## 7. The flake class, removed at the root

Every intermittent failure across Phases 1–3 had one cause: 33 test files sharing one Postgres and one Redis. Today alone that produced a file deleting an actor another was mid-test on, a global row count moving under a parallel insert, a shared rate limiter tripping at 30/min, and a BullMQ round trip starved of the event loop. Each was fixed individually and another appeared.

Set **`fileParallelism: false`**. Files run one at a time; tests *inside* a file still run as written, so every deliberate concurrency test — the Claim upsert race, the actor-resolver race, the idempotency-key race — is untouched and still proves what it did.

Cost: **~20s → ~71s** wall clock. Good trade for a suite whose entire job is to be believed. Five consecutive clean runs confirm it.

I chased the BullMQ failure through three wrong hypotheses first (timeout too tight, jobId collision, queue backlog) — each disproved by checking Redis directly rather than assuming. Worth recording: the queue was empty and Redis had zero rejected connections, which is what ruled out the first three.

---

## 8. Verification

```
typecheck   clean
lint        clean
tests       465 passed | 5 skipped | 0 failed   (470 total, 33 files)
            FIVE consecutive clean runs, ~71s each
```

Up from Phase 2's 425 → **+40 tests**. Still zero `vi.mock()`.

- `test/rule-engine.test.ts` — 27 pure tests
- `test/v2-capability.db.test.ts` — 13 tests, real Postgres over real HTTP

### Live

| Action | Amount asked | Result | Capability granted |
|---|---|---|---|
| CLAIM | 50 USDC | `ALLOW` | `GRANT`, 1h expiry |
| TRADE | 5,000 USDC | `LIMIT` | `ATTENUATED_GRANT`, **500 USDC**, 20/day, 24h |
| BORROW | 50,000 USDC | `CHALLENGE` | none |

Phases 0–2 re-verified in the same pass: registry still 110 rows, V1 gate still `ALLOW`.

---

## 9. Files changed

**New**
```
src/authorization/policy-evaluator.ts         the interface (Cedar seam)
src/authorization/rule-engine.ts              pure matching + effects
src/authorization/native-policy-evaluator.ts  rule-row implementation
src/capabilities/capability-types.ts          pure attenuation
src/capabilities/capability-service.ts        grant, check, usage, revoke
prisma/seed-data/policy-rules.ts              18 seeded rules
test/rule-engine.test.ts, test/v2-capability.db.test.ts
prisma/migrations/…_add_capability_policy/
```

**Modified**
```
prisma/schema.prisma        Policy, PolicyRule, Capability, CapabilityUsage, AssuranceLease
src/intent/intent-service.ts  policy authoritative; grants capabilities
src/config/env.ts           policy cache + 5 lease TTLs
src/v2/routes.ts            GET /v2/actors/:id/capabilities
vitest.config.ts            fileParallelism: false
test/invalidation-worker.db.test.ts  decoupled from shared fixture wallet
test/v2-actor-intent.db.test.ts      reason codes now owned by rule rows
```

---

## 10. Carried into ENS / Phase 4

1. **ENS is now unblocked.** `Capability` exists, which is what ENSv2's Enhanced Access Control maps onto. Recommended next, before Phase 4.
2. **Capabilities are recorded but not yet enforced at an execution boundary** — nothing calls `checkCapability` from a real execution path yet. That's Phase 8, and it's where an ENS/EAC adapter would slot in.
3. **`recordUsage` is never called by the intent flow** — frequency limits are enforceable and tested, but nothing exercises a capability yet. Same Phase 8 dependency.
4. **No lease is ever established** until Phase 5's World flow.
5. **Evidence lineage still source-level**, unchanged since Phase 1.
6. The policy is **a demo policy, not a validated model** — same honesty as V1's weights.
