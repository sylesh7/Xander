# Phase 2 — Trust Context

**Status:** Complete
**Date:** 2026-09-12
**Spec:** `Xander/xander-v2-backend.md` §33 Phase 2, trust model §6, §5.6, §21
**Goal:** Unify V1 risk data with the new multi-dimensional trust model.

**Done when:** *"The backend can distinguish ESTABLISHED_LOW / HIGH_RISK / INSUFFICIENT_EVIDENCE without treating all unknown wallets as low risk."* — met, and asserted in a single test that evaluates all three in one run.

---

## 1. The one idea

V1 answers "how risky is this wallet?" with a single number. That number cannot express *"we have no idea"* — a brand-new wallet scores 0, and 0 is indistinguishable from "we looked hard and it's clean."

Phase 2 replaces it with a seven-dimension vector where **absence of evidence is representable**:

```
behaviorIntegrity · coordinationRisk · historyStrength · humanAssurance
agentReputation · evidenceFreshness · investigationConfidence
```

**The type system carries the rule, not a convention.** A dimension's value is `number | null`, and `null` means UNKNOWN. There is no numeric encoding of ignorance, so no arithmetic can average it into confidence, and every consumer is forced by the compiler to decide what absence means. The Prisma columns are nullable for the same reason — a `0` in the database would be read as "measured, and clean" by the first query that touched it.

That is invariant 3.2 (*"a new wallet is represented as INSUFFICIENT_EVIDENCE, not as SAFE"*) made structural rather than aspirational.

---

## 2. What is genuinely measured vs honestly unknown

| Dimension | Phase 2 source | Real? |
|---|---|---|
| `coordinationRisk` | V1's real cluster risk score | ✅ measured |
| `evidenceFreshness` | real evidence age, classified | ✅ measured |
| `historyStrength` | real evidence span × volume | ✅ measured |
| `behaviorIntegrity` | derived from this phase's own drift detector | ✅ measured |
| `humanAssurance` | a real `PASSED` World challenge, if one exists | ✅ measured |
| `investigationConfidence` | a real completed MCP investigation, if one exists | ✅ measured |
| `agentReputation` | — | ❌ **UNKNOWN until Phase 6** |

`agentReputation` staying null is the design working. A neutral default would be indistinguishable from a measured mediocre reputation, so it says `"ERC-8004 reputation not yet integrated (Phase 6)"` and the band derivation simply has one fewer dimension to work with.

Every dimension carries a `basis` string. A trust number nobody can account for is not auditable, and §3.6 requires decisions to carry lineage.

---

## 3. Band derivation is ordered, not weighted

```
1. too few measured dimensions   -> INSUFFICIENT_EVIDENCE
2. coordinationRisk unknown      -> INSUFFICIENT_EVIDENCE
3. risk >= critical              -> CRITICAL
4. risk >= high                  -> HIGH_RISK
5. low risk + verified human     -> VERIFIED_LOW
6. low risk + established history-> ESTABLISHED_LOW
7. otherwise                     -> UNCERTAIN
```

**Averaging would have been a security hole.** A World-verified, long-lived, perfectly-behaved actor sitting inside a confirmed coordinated ring would average out to "fine". Risk is checked first and can only move the band *downward*. There is a test that constructs exactly that actor — every other dimension at 1.0, coordination at 0.85 — and asserts `CRITICAL`.

`INSUFFICIENT_EVIDENCE` was added as a sixth band beyond the spec's five. The spec lists five and separately insists UNKNOWN is "a trust/evidence state, not a risk score" — but Phase 2's own acceptance condition requires distinguishing it. Without it, cold-start actors fall into `UNCERTAIN`, which reads as *"we measured and it was mixed"* rather than *"we have nothing"*.

---

## 4. Drift detects, it never judges

Six signals per §6.3: new counterparty, unusual amount, new protocol category, new timing regime, sequence deviation, sudden cluster expansion.

§6.3 is emphatic that *"behavior drift is a signal, not an automatic proof of abuse"* — a legitimate user really does start using a new protocol. So `DriftResult` reports what changed and by how much and **carries no verdict field**. There's a test asserting its keys are exactly `{signals, peakMagnitude, hadBaseline}`, so a future `abusive: true` would fail loudly.

Two details worth keeping:

- **`hadBaseline: false` ≠ "no drift".** A brand-new actor has not *stopped* behaving normally; there is nothing to have deviated from. Reporting that as clean would be the cold-start mistake in a different costume.
- **Amounts compare in `bigint`.** A 1e21-base-unit transfer is far past `Number.MAX_SAFE_INTEGER`. The comparison is exact; the float ratio is computed only afterwards, for the reported magnitude, so precision loss can never change the outcome.

Median, not mean, for the amount baseline — same reasoning the V1 risk engine uses.

---

## 5. History is append-only

Two models, per §21's *"a history of decisions, not simply one mutable score"*:

- **`TrustSnapshot`** — the computed vector at a moment. A re-evaluation writes a **new row**, never an update, so a decision that cited snapshot N stays reconstructable after N+1 exists.
- **`TrustSignal`** — the ledger of events that earned it. `positive` is derived from the kind rather than accepted from the caller, so one event can't be positive in one place and negative in another.

**The signal balance is reported but never fed into the band.** §3.1 keeps deterministic evidence in charge; letting an accumulated tally move a band would mean a run of routine successes could offset a live coordination signal. There's a test that records five successes against a ring actor and asserts the band does not move.

---

## 6. A correctness bug caught by the regression run

Phase 2 initially called `getRiskThroughCache` a second time inside `buildTrustContext`, on top of the call the intent flow had already made.

That is not just wasted work. A cache expiry or a Substreams invalidation landing between the two calls would return a **different score**, and the snapshot a decision cites would then describe evidence that decision never saw. The trust context now accepts the already-computed risk: **one computation, one lineage.**

---

## 7. Cumulative regression — this is what it caught

Per the new standing rule, Phases 0→2 were verified together, not just Phase 2. Running the full suite repeatedly surfaced **three separate defects** that the Phase 2 file alone never showed:

1. **Rate limiting, misdiagnosed as a logic bug.** Adding `/v2/actors/:id/trust` behind the shared `upstreamRateLimit` pushed the parallel suite past 30 req/min. It surfaced as `res.body.decision` being *undefined* — because the request had actually been answered `429`. Fixed by raising the limit **in the test env only** (production keeps 30/min; no test asserts that threshold), and by adding explicit status assertions so a 429 can never again hide behind an undefined read.

2. **Cross-file actor destruction.** Both `/v2` suites bind actors to the same fixture wallets and both deleted them in `afterAll`. Whichever finished first deleted the actor the other was mid-test on, cascading away its in-flight intents — a real `500`. Cleanup now never deletes an actor bound to a shared fixture wallet.

3. **A shared-actor race in my own test.** `?fresh=false` asserted "latest snapshot == the one I just built" on a shared fixture actor, while the parallel intent suite — which now builds a trust context on every call — snapshotted the same actor. Moved to a dedicated actor.

All three were *my* defects, introduced by Phase 2, in Phase 1 and Phase 0 territory. Exactly the class of thing the cumulative rule exists to catch.

---

## 8. Verification

```
typecheck   clean
lint        clean
tests       425 passed | 5 skipped | 0 failed   (430 total, 31 files)
            FIVE consecutive clean full-suite runs
```

Up from Phase 1's 375 → **+50 tests**. Still zero `vi.mock()`.

- `test/trust-vector.test.ts` — 32 pure tests (bands, cold start, drift, freshness)
- `test/v2-trust.db.test.ts` — 18 tests against real Postgres over real HTTP

### Live, real server, real Graph

| Wallet | V1 result | Trust band |
|---|---|---|
| Clean fixture | `ALLOW` | `UNCERTAIN` |
| Coordinated ring | `BLOCK` | `CRITICAL` |
| Random unused | `REVIEW` | `INSUFFICIENT_EVIDENCE` |

The ring actor's live vector, unedited:

```
coordinationRisk         0.846  KNOWN    cluster risk 0.8465 under policy 1.0
historyStrength          0.01   KNOWN    3 events over 0.3 days
evidenceFreshness        1      KNOWN    evidence freshness is FRESH
behaviorIntegrity        null   UNKNOWN  not enough history for a baseline
humanAssurance           null   UNKNOWN  no completed World verification
agentReputation          null   UNKNOWN  ERC-8004 not yet integrated (Phase 6)
investigationConfidence  null   UNKNOWN  no completed investigation
```

**The clean fixture wallet bands `UNCERTAIN`, not `ESTABLISHED_LOW`** — it has only two seeded events over a short span, so `historyStrength` is genuinely low. That is the honest answer, not a bug: low risk plus thin history is exactly what UNCERTAIN means. A wallet with real months of history would reach `ESTABLISHED_LOW`, which is what the unit tests assert directly.

Phase 0 and Phase 1 surfaces re-verified live in the same pass: the known-funder registry still holds 110 rows (10 bridges / 100 exchanges), and the V1 claim gate still returns a real `ALLOW`.

---

## 9. Files changed

**New**
```
backend/src/trust/trust-types.ts     dimensions, bands, freshness, signal kinds
backend/src/trust/trust-vector.ts    pure band derivation + cold-start bootstrap
backend/src/trust/trust-drift.ts     pure six-signal drift detector
backend/src/trust/trust-context.ts   impure assembly + snapshot persistence
backend/src/trust/trust-history.ts   append-only signals and history
backend/test/trust-vector.test.ts    32 pure tests
backend/test/v2-trust.db.test.ts     18 integration tests
backend/prisma/migrations/…_add_trust_context/
```

**Modified**
```
backend/prisma/schema.prisma        TrustSnapshot, TrustSignal
backend/src/config/env.ts           15 trust knobs, no inline numbers
backend/src/v2/routes.ts            GET /v2/actors/:id/trust, .../trust/history
backend/src/intent/intent-service.ts  decisions now cite a real trustSnapshotId
backend/vitest.config.ts            test-only rate limit headroom
backend/test/v2-actor-intent.db.test.ts  fixture-actor cleanup protection
Backend-Suganthan.md / Backend-Sylesh.md  Section 0.4 log
```

---

## 10. Carried into Phase 3

1. **`riskScore`/`clusterId`/`confidence` stayed on `AuthorizationDecision`.** Phase 1 said Phase 2 would "move" them. I deliberately kept them as a denormalised V1 lens for fast reads and *added* `trustSnapshotId` alongside — dropping columns is a destructive migration for no benefit. Stating it because it differs from what Phase 1 promised.
2. **Evidence lineage is still source-level**, not `EvidenceEvent` row ids — unchanged from Phase 1, still blocked on the locked interface.
3. **Trust does not yet change any outcome.** Phase 2 builds and records the context; the result still comes from V1's policy engine. There is a test asserting exactly this, so nobody later assumes the band is load-bearing. **Phase 3 is what makes it authoritative.**
4. **`LIMIT` still unreachable** until the capability engine.
5. **ENS**: still just the identity-kind hook. Recommended placement remains immediately after Phase 3, once `Capability` exists for EAC to map onto.
