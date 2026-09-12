# Phase 5 — World Agent + active liveness

**Status:** Complete
**Date:** 2026-09-12
**Spec:** `Xander/xander-v2-backend.md` §33 Phase 5, §9, §10, §11 — plus the World/MediaPipe direction change agreed mid-build.

**Done when:** *"A user can create one agent, establish World-backed assurance, complete active liveness, and receive an initial bounded capability set."* — met, asserted as a single test.

---

## 1. The flow

```
create agent ──▶ World Selfie Check ──▶ [optional] active liveness
                                              │
                                              ▼
                                    ASSURANCE LEASE (rotating)
                                              │
                                              ▼
                                  bounded capability envelope
```

World **establishes** the lease. Active liveness **rotates** it. Lease expiry withdraws the capabilities that hung off it. That's the direction change we settled on, built as agreed.

Lease length is a function of what was actually proven:

| Proven | Lease |
|---|---|
| World only | **1 hour** |
| World + fresh liveness | **12 hours** |

A credential proves someone was verified *once*; a liveness proof says someone is present *now*. The lease encodes which one we have.

---

## 2. Server-side landmark verification

This is the piece that matters. The frontend runs MediaPipe locally and sends a **landmark time-series** — the backend verifies the geometry itself, deterministically.

**Why not a client boolean:** `{result: "PASS"}` is forgeable with one curl. Nonce, expiry and session binding stop *replay* but not *forgery*. Forging a landmark trace means synthesising a plausible trajectory that satisfies a **randomly chosen** target, per attempt, against a nonce the attacker didn't pick.

The rejection rules, each a real attack:

| Rule | Attack it stops |
|---|---|
| **Transition required** | A photograph. A printed hand holding 3 fingers gives a constant count forever and would otherwise pass outright. |
| **Target must be *held*** | A hand opening 0→5 sweeps through 3 on the way. One matching frame is not the gesture. |
| **Monotonic timestamps** | Time running backwards means frames were stitched from multiple recordings — that's how a replay is assembled. |
| **Duration floor / ceiling** | A trace too fast to be real movement, or a stale recording replayed slowly. |
| **Single use on fail too** | Consuming only successes turns one nonce into unlimited retries until a synthetic trace happens to land. |

**Rotation invariance.** Finger extension is measured as *distance from the wrist*, not the common `tip.y < pip.y`. That shortcut assumes an upright hand — rotate 90° and it silently reports a fist. There's a test that rotates a 3-finger hand about the wrist and asserts it still counts 3. A challenge that only works for people sitting perfectly straight is a challenge that fails honest users.

**Landmark indices were verified, not recalled** — read from two files in the MediaPipe source tree, which agreed.

### What this is not

It does **not** prove personhood and it is **not** a deepfake detector. A determined attacker with a landmark generator beats it. World's credential remains the actual assurance; this is the session-freshness layer, and the code says so at the top of the module.

---

## 3. Privacy

**No biometric material is stored.** The backend receives landmarks, verifies them, and persists only the derived integer counts that justify the verdict. A test asserts the stored record's `signalJson` has exactly one key (`observedCounts`) and that the serialised row contains no `landmarks` anywhere. Sections 3.7 and 28.

---

## 4. Assurance cannot be asserted, only proven

`establishAssurance` takes proof **ids**, then re-reads them from the database and checks that each exists, **PASSED**, and belongs to this agent's actor. Passing an id is a claim; accepting the claim would make the whole assurance step a matter of asking nicely.

Three tests cover it: no World verification → 400, a `FAILED` World challenge → 400, and **another actor's** liveness proof → 403.

---

## 5. Freeze is a state transition, not a flag

Per §19.3. Freezing an agent moves its status **and** suspends every capability its actor holds — an agent marked frozen whose capabilities still pass `checkCapability` is not frozen.

Unfreeze **refuses if the assurance lease has expired** (409). Restoring authority that nothing currently vouches for is exactly the hole the lease model exists to close. Revoke is terminal — `REVOKED` has no outgoing transitions, because an agent whose authority was destroyed should be replaced, not resurrected.

The transition table is total (`Record<AgentStatus, AgentStatus[]>`) rather than scattered `if`s, so an illegal jump can't be written by accident.

**One bug this caught in my own code:** `establishAssurance` jumped `DRAFT → HUMAN_BACKED`, skipping `VERIFYING`. The state machine rejected it with a 409 and it now walks the lifecycle properly — the intermediate state is what an operator sees while assurance is outstanding.

---

## 6. The capability envelope is bounded

"Verified" does not mean "unlimited". A newly human-backed agent gets `CLAIM` and `API_REQUEST` with frequency bounds, both tied to the lease. The test asserts every granted capability has a frequency limit and an `assuranceLeaseId`, and that **no** `BORROW` or `TRANSFER` was granted on the strength of verification alone — anything touching value goes through a real intent and is judged on its own terms.

---

## 7. Verification

```
typecheck   clean
lint        clean
tests       526 passed | 5 skipped | 0 failed   (531 total, 37 files)
            four consecutive clean runs
```

Up from Phase 4's 490 → **+36 tests**. Still zero `vi.mock()`.

- `test/liveness-geometry.test.ts` — 19 pure tests (every rejection path, rotation invariance)
- `test/v2-agent.db.test.ts` — 17 tests, real Postgres over real HTTP

---

## 8. A finding worth acting on later

`TrustSnapshot` is append-only **by design** (§21 wants a history, not a mutable score). One shared fixture actor has accumulated **96 snapshots** across test runs, and it grows every run — the suite gets measurably slower over time, which is what pushed one Phase 1 test past its 30s budget.

Raised that test to 60s to match the other heavy ones, but the underlying issue is real: **there is no retention policy**. §33 Phase 12 lists "retention policy" explicitly, and this is the first concrete evidence of why it's needed rather than a checkbox.

---

## 9. Files

**New**
```
src/verification/liveness-geometry.ts   pure geometry, MediaPipe landmark verification
src/verification/liveness-service.ts    issue/verify, nonce, single-use, session binding
src/agents/agent-service.ts             lifecycle, assurance, capability bootstrap
test/liveness-geometry.test.ts          19 pure tests
test/v2-agent.db.test.ts                17 integration tests
prisma/migrations/…_add_agent_liveness/
```

**Modified:** `prisma/schema.prisma` (`Agent`, `LivenessChallenge`), `src/config/env.ts` (5 settings), `src/v2/routes.ts` (9 routes), `test/v2-actor-intent.db.test.ts` (timeout).

---

## 10. Carried forward

1. **ENS is not wired into agent creation.** Phase 3.5 can mint `alpha.xander.eth` and grant EAC roles; `createAgent` doesn't call it. The `Agent.ensName` / `ensTokenId` columns exist and sit empty. This is the most valuable remaining integration and it's small — the primitives are built and proven.
2. **AgentBook / World AgentKit not integrated.** §9.1 mentions them; this phase used the Selfie Check path we already had working end to end rather than an SDK surface I couldn't verify. `Agent.worldAgentId` is reserved.
3. **The frontend MediaPipe capture doesn't exist.** The backend contract is complete and tested; producing real landmark traces from a camera is frontend work.
4. **Nothing rotates a lease yet.** Expiry withdraws capabilities, but no flow re-proves liveness to extend one. Phase 4's capability-lease workflow is the natural host.
5. **No retention policy** — see §8.

---

# Phase 5.5 — ENS wired into agent creation

**Status:** Complete
**Date:** 2026-09-12

The gap Phase 5 left: the ENS primitives worked and the agent lifecycle worked, but nothing connected them. Now they are one thing.

## The seam

```
createAgent        -> mint <label>.xander.eth, real on-chain expiry
establishAssurance -> grant EAC roles matching the capability envelope
freeze / revoke    -> revoke those roles with a real transaction
```

## Two rules govern it

**1. The database is authoritative for security; the chain is the public mirror.**
A freeze suspends capabilities locally *first*, and that is the enforcement. Making revocation depend on a healthy RPC would turn an RPC outage into an inability to stop a misbehaving agent. There's a test that freezes with the chain unavailable and asserts capabilities really are suspended.

**2. Never report an on-chain action that did not happen.** (§18.2)
Every response carries `ens: { revokedOnChain, skipReason, txHash, detail }`. When there's no operator key, `minted: false` with `skipReason: "NO_OPERATOR_KEY"` — never a silent success. A mint failure does **not** fail agent creation either: the agent is a real, usable record, and rolling it back because Sepolia was slow would trade a working agent for no agent.

Minting is **opt-in** via `ensLabel`. A real transaction costs gas and ~15s; doing it silently on every create would make agent creation slow and expensive for callers who never wanted a name.

## Verified on real Sepolia

`npm run check:agent-ens`, unedited:

```
[OK] identity minted          a2badd7.xander.eth (tx 0x89ed2d83…)
[OK] on-chain expiry          2026-10-12T10:22:06.000Z
[OK] roles before assurance   none — a name is not an authorisation
[OK] agent status             ACTIVE
[OK] capabilities granted     2
[OK] roles mirrored on-chain  granted CLAIM, API_REQUEST
[OK] roles readable by anyone CLAIM, API_REQUEST
[OK] db and chain agree       CLAIM, API_REQUEST
[OK] frozen                   FROZEN, 2 capabilities suspended
[OK] roles revoked on-chain   tx 0xab1756f6…
[OK] authority actually gone  no roles remain on-chain
[OK] identity survives freeze a2badd7.xander.eth
```

Three of those lines are the ones worth showing anyone:

- **"a name is not an authorisation"** — minting an identity grants nothing. Authority arrives only after assurance, separately.
- **"db and chain agree"** — the actions permitted in Xander and the roles held on-chain are compared, not assumed.
- **"authority actually gone"** — freeze is a transaction anyone can verify, not a flag in our database.

The name **survives** the freeze. The agent still exists; it simply cannot act.

## Tests

```
530 passed | 5 skipped | 0 failed   (535 total, 37 files)
three consecutive clean runs
```

+4 over Phase 5, covering the honest-degradation paths: no label, no operator key, malformed label rejected at the schema boundary, and freeze working with the chain unavailable.

## Still open

1. **Only action types cross to the chain.** Amount ceilings and rate limits have no EAC representation and stay in Xander — the chain says *what*, the database says *how much and how often*.
2. **No renewal.** Agent names expire in 30 days and nothing renews them. Phase 4's capability-lease workflow is the natural host.
3. **Roles are held by the operator address**, not by an address the agent controls. Deliberate — the human backing the agent holds the name — but it means "the agent's roles" are really "the operator's roles scoped to the agent's resource".
