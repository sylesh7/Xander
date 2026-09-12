# Phase 8 — Enforcement

**Status:** Complete
**Date:** 2026-09-12
**Spec:** §33 Phase 8, §18

**Done when:** *"At least one high-value agent action is prevented at the actual execution boundary."* — met twice over: once by a local ceiling, and once by revoking a role on real Sepolia while the local database still said ALLOW.

---

## 1. What changed

Phase 1 left a marker in `intent-service.ts`:

```ts
// Section 18.2 — nothing is executed until an enforcement adapter says so,
// and Phase 1 has no enforcement.
executionStatus: 'NOT_EXECUTED',
```

Every receipt Xander had ever written said `NOT_EXECUTED`, because nothing stood between a decision and the action. An `ALLOW` was a row in a table. This phase is the part where the answer starts costing something.

```
decision authorized?  →  every applicable boundary confirms NOW?  →  executor runs
        ↓ no                        ↓ no                                ↓
BLOCKED_UNENFORCEABLE     BLOCKED_UNENFORCEABLE              EXECUTED_AS_AUTHORIZED
```

The re-check happens **at execution time, not at decision time**. A decision made an hour ago rests on trust that may since have collapsed — Phase 7 made that collapse suspend capabilities, and this is where the suspension actually stops something.

---

## 2. Three states, never two

`EnforcementResult.outcome` is `CONFIRMED | FAILED | UNKNOWN`, and `CapabilityState.enforceable` is `boolean | null`.

§18.2 says: *"If Xander cannot prove that a capability was successfully granted/restricted, the action must not be reported as `EXECUTED_AS_AUTHORIZED`."*

A boolean collapses the dangerous case into one of the safe ones. An adapter that timed out mid-revoke has left authority in an **unknown** state; reporting that as either success or failure is a lie. `isEnforced()` exists as a function rather than an inline comparison so no caller can write `outcome !== 'FAILED'` and quietly turn an RPC timeout into an authorization.

---

## 3. The composition rule

**Every applicable boundary must positively confirm.** Not "no boundary objected" — silence is not permission.

| adapter | what it enforces | what it cannot |
|---|---|---|
| `local` | amount ceilings, frequency, targets, expiry, lease liveness, status | anything outside Xander's DB |
| `ens-eac` | *which action types* an agent may perform, on Sepolia | magnitude — EAC roles are single bits |

An actor's boundaries are resolved per-actor: the local store always governs; the chain governs only when a real ENS identity backs the actor. Asking an EAC registry about a bare wallet returns "no role", which is indistinguishable from a denial — so it is never asked.

Because roles carry no magnitude, `ens-eac.attenuate()` returns **`UNKNOWN`, not `CONFIRMED`**. Claiming to have narrowed an on-chain limit that has no on-chain existence is precisely the lie §18.2 forbids.

---

## 4. On-chain adapter choice

The spec lists Safe or OpenZeppelin AccessManager for the "one concrete onchain enforcement demo". We used the **ENSv2 EAC registry Phase 3.5 already deployed and funded** (`0x8993Df8b8f5C10d9B3d157B7191431429c51F039`) — a real, live, role-gated permission surface we control. Deploying a second contract would have demonstrated the same property at more cost.

The seam in `enforcement-adapter.ts` is what keeps that a swappable decision rather than a coupling. §18.1: *"Do not couple the policy engine directly to Safe or ERC-7715."*

**ERC-7715 (step 2 in the spec's order) is NOT implemented.** It needs a wallet that supports `wallet_grantPermissions` — a browser-side MetaMask Delegation Toolkit session. There is no honest server-side way to do it, and a stub would be a fake. Carried forward, stated plainly.

---

## 5. Files

| file | role |
|---|---|
| `src/authorization/enforcement/enforcement-adapter.ts` | the §18.1 seam; three-state outcome; `isEnforced()` |
| `src/authorization/enforcement/local-adapter.ts` | Xander's own capability store as a boundary |
| `src/authorization/enforcement/ens-eac-adapter.ts` | real Sepolia EAC roles |
| `src/authorization/enforcement/enforcement-service.ts` | composition, `revokeEverywhere`, `enforcementStatus` |
| `src/authorization/enforcement/execution-service.ts` | the gate; writes the receipt |
| `scripts/check-enforcement.ts` | live on-chain proof (`npm run check:enforcement`) |
| `test/v2-enforcement.db.test.ts` | 22 tests, real Postgres, real HTTP |

**Migration** `20260912112520_add_enforcement_provenance` adds `enforcementAdapters`, `enforcementReason` and `executedAt` to `ActionReceipt`, and widens `executionStatus` to `NOT_EXECUTED | EXECUTED_AS_AUTHORIZED | BLOCKED_UNENFORCEABLE | FAILED`. **A receipt now names the boundaries that proved it** — a proof nobody can trace is not a proof.

**Routes:** `POST /v2/intents/:id/execute` (200 executed / 409 refused / 404 unknown), `GET /v2/actors/:id/enforcement`.

---

## 6. FAILED is not BLOCKED

If authority was proven and the executor then threw, the receipt says `FAILED`, not `BLOCKED_UNENFORCEABLE`. Conflating a broken integration with a policy denial hides an outage behind something that looks deliberate.

Usage is recorded **after** the action, so a failed execution does not consume a frequency slot the actor never used. There is a test for exactly that.

---

## 7. The acceptance condition, proven

### Local ceiling (`test/v2-enforcement.db.test.ts`)

The executor is a real closure with an observable side effect, so "blocked" means the side effect did not happen — not that a status string says so.

```
authorized for 1,000,000 base units; intent asks for 900,000,000,000
→ executor.calls() === 0
→ BLOCKED_UNENFORCEABLE
→ receipt.executedAt === null, receipt.executionTxHash === null
```

### On-chain (`npm run check:enforcement`, live Sepolia)

The part that cannot be faked. **The database still holds an `ACTIVE` capability; only the public chain changed.**

```
  [OK]   identity minted                eb757e7.xander.eth
  [OK]   boundaries before assurance    local + ens-eac
  [OK]   nothing authorized yet         local: No capability for CLAIM.; ens-eac: eb757e7 does not hold CLAIM on-chain
  [OK]   capabilities granted           2
  [OK]   roles mirrored on-chain        granted CLAIM, API_REQUEST
  [OK]   dual-governed action           CLAIM (local + ens-eac)
  [OK]   both boundaries confirm        confirmed by local + ens-eac
  [OK]   authorized action ran          EXECUTED_AS_AUTHORIZED via local + ens-eac
  [OK]   on-chain role revoked          tx 0xf50d0517af64e6ac6f4ae9e05ce2e7c8f2e7e1a5ea02bdcb4515c60b80690f74
  [OK]   database unchanged             1 capability still ACTIVE locally
  [OK]   verdict now refuses            ens-eac: eb757e7 does not hold CLAIM on-chain
  [OK]   ACTION PREVENTED BY CHAIN      ens-eac: eb757e7 does not hold CLAIM on-chain

Enforcement proven: authority removed on-chain stops the action in Xander.
```

13/13, exit 0, two real Sepolia transactions per run.

---

## 8. Cumulative regression, Phase 0 → 8

| check | result |
|---|---|
| `npm test` × 3 consecutive | **584 passed, 5 skipped, 0 failed** — identical every run |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run check:graph` | Token API, Standardized Subgraphs @ block 25961294, Substreams endpoints — OK |
| `npm run check:ens` | all 8 ENSv2 contracts, parent name, registrar, role bitmaps, operator 0.115 ETH — OK |
| `npm run check:erc8004` | all three registries, `getSummary` decodes, UNKNOWN not fabricated — OK |
| `npm run check:enforcement` | 13/13 live on Sepolia |

Test count went 562 → 584 (+22).

---

## 9. One correction made during this phase

The script originally asserted that only the local boundary governs an agent before assurance. **The live run disproved it** — the chain boundary applies from the moment the *name* exists, not from the moment authority is granted. The comment was wrong, not the code; a name holding no roles is a boundary that correctly refuses. The assertion was rewritten to state the true property and now checks it (`nothing authorized yet`).

Also: one test assertion expected the denial enum (`AMOUNT_EXCEEDS_LIMIT`) in a field that carries human prose. Fixed the assertion, not the code — it now asserts the refusal names the actual numbers, which is the property an operator needs.

---

## 10. Carried forward

- **ERC-7715 adapter** — needs a browser wallet; not implemented rather than faked.
- **Phase 7's `applyConsequence` is local-only.** A `CRITICAL` trust collapse revokes in the database but does not push a revoke on-chain. It doesn't need to for correctness — the execution gate blocks either way, since `local` must also confirm — but the public record will lag until the agent is frozen. Deliberate: putting a gas-paying transaction inside the invalidation worker's hot path would make trust rebuilds slow and failure-prone.
- **No retention policy** on `TrustSnapshot` (unchanged from Phase 7).
- **Nothing renews ENS agent names** (30-day expiry).
- **No route starts a Temporal workflow.**
