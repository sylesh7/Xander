# Phase 7 — Live trust mutation

**Status:** Complete
**Date:** 2026-09-12
**Spec:** §33 Phase 7, §13

**Done when:** *"A new onchain event can change an agent's TrustSnapshot and cause an active capability to be attenuated or frozen."* — met, driven through the real invalidation path.

---

## 1. What changed

Before this phase, a live on-chain event refreshed a cache and stopped there. An actor could become materially riskier while still holding authority granted an hour earlier against the old picture. **A capability outlived the evidence that justified it.**

```
on-chain event → evidence → trust rebuild → band comparison
               → capability attenuated / suspended / revoked
               → Temporal signalled
```

---

## 2. Consequences are driven by where the actor IS

| Current band | Consequence |
|---|---|
| `CRITICAL` | **REVOKE** |
| `HIGH_RISK` | **SUSPEND** |
| `INSUFFICIENT_EVIDENCE` | **SUSPEND** (reversible) |
| `UNCERTAIN` | **ATTENUATE** (halve ceilings) |
| improved / unchanged | none |

Not by how far they fell. A two-band drop into `UNCERTAIN` is the same situation as a gentle drift into it — what matters is where they are now.

**`INSUFFICIENT_EVIDENCE` ranks above `UNCERTAIN` but below `HIGH_RISK`.** Losing the ability to measure someone is worse than having measured them as ambiguous — we can no longer justify what they hold — but it isn't evidence of coordination. Ranking it harmless would let an actor escape scrutiny by going quiet until their evidence went stale.

It **suspends rather than revokes**, because absence of evidence is not proof of wrongdoing and a revoke can't be undone.

`UNCERTAIN` **attenuates rather than strips**. An actor who became merely ambiguous has done nothing wrong; removing everything for ambiguity is the false-positive behaviour this project exists to avoid.

---

## 3. Three conservative guarantees

- **First evaluation does nothing.** No prior band means nothing to compare against; treating that as degradation would punish every actor the moment they're first seen.
- **Improvement never widens authority.** Rising trust is a reason to grant more on the *next* request, judged by policy against the actual action — never to retroactively expand a grant nobody re-evaluated. There's a test that degrades then recovers and asserts the ceiling doesn't come back.
- **Attenuation is exact.** Ceilings are `uint256` base units halved in `BigInt`; a nonsense divisor can never *widen* a limit.

---

## 4. Ordering and failure

The mutation runs **after** the cache write and is wrapped. The V1 invalidation contract is "evict and repopulate" — a failure in the V2 consequence path must not fail the job and trigger a retry that redoes the whole refresh.

Temporal signalling is best-effort. Capability changes are the actual enforcement; Temporal being down must not stop them.

---

## 5. Verification

```
typecheck clean · lint clean
562 passed | 5 skipped | 0 failed  (567 total, 40 files)
three consecutive clean runs
```

+24 over Phase 6. `test/trust-mutation.test.ts` (18 pure), `test/v2-trust-mutation.db.test.ts` (6 real-Postgres).

The headline test drives `mutateTrustForWallets` — the same function the Substreams sink calls — not the mutation function directly.

**A test bug worth recording:** the first version inserted evidence with `sourceType: 'substreams'`. The Phase 11 freshness guard requires a live `SubstreamsCursor` row for that chain, so the actor sat at `INSUFFICIENT_EVIDENCE` from the start and had no band to fall *from* — the test passed nothing and proved nothing. Corrected to `token-api`, which the guard judges on `createdAt` recency alone.

---

## 6. Carried forward

1. **Nothing calls `mutateTrustForWallets` from a live stream yet in production** — it runs inside the invalidation worker, which the Substreams sink feeds. Proven in tests; a real end-to-end stream→freeze demo would need a live stream against an actor that holds capabilities.
2. **The spec's §13.1 event categories** (`NEW_COUNTERPARTY`, `CLUSTER_MUTATION`, …) are not modelled as distinct types — every invalidation is treated the same way. The consequence depends on the resulting band, not the event kind, which is simpler and arguably more honest, but it does mean the categories are unused.
3. **Attenuation is unconditional halving.** A smarter policy-driven reduction would be better but needs a rule shape for it.
