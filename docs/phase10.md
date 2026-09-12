# Phase 10 — AI Security Operations

**Status:** Complete
**Date:** 2026-09-12
**Spec:** §33 Phase 10, §14.1, §15, §23

**Done when (spec):** *"A live anomaly produces a traceable investigation that identifies supporting and contradicting evidence and feeds a deterministic policy decision."*

---

## 1. The rule this phase turns on

§15.3, verbatim:

> The AI may recommend `ALLOW / LIMIT / REVIEW / BLOCK`, **but the recommendation is passed back into deterministic policy evaluation. It is not itself the authorization authority.**

`reconcileRecommendation` makes that structural rather than aspirational, with one asymmetry:

```
the AI may TIGHTEN the deterministic decision.
the AI may NEVER loosen it.
```

An investigator that can only escalate is useful — it finds what the deterministic features missed, and a false escalation costs a human review. An investigator that can **de-escalate is an authorization bypass reachable by prompt injection**: anyone who can get text into the evidence the model reads can argue their way out of a block. No amount of model quality makes that acceptable, so it is refused in code rather than discouraged in a prompt.

Corollaries, each with a test:
- a **garbled** recommendation ranks as `BLOCK`, so a hallucinated verb or empty string can never read as `ALLOW`
- **no** recommendation leaves the deterministic floor standing
- an overruled recommendation is **recorded, not erased** — an investigator repeatedly arguing below the floor is itself a signal

Proven live, through the real Temporal workflow:

```
[OK]   AI finding delivered             recommended ALLOW
[OK]   AI DE-ESCALATION REFUSED         applied RESTRICT, not ALLOW
[OK]   deterministic decision stood     HIGH -> REVIEW -> RESTRICT
```

---

## 2. Counter-evidence is deterministic, not delegated

§15.2 makes "query supporting evidence" and "query **counter**-evidence" two separate mandatory steps. Counter-evidence is gathered from the database **before any model sees the case**, because leaving "also consider the other side" to an LLM is not a control, it is a hope.

Four checks, each targeting a way an innocent population produces a coordination-shaped signal:

| check | what it catches |
|---|---|
| `SHARED_FUNDER_IS_LABELLED` | the **Arbitrum case** — a shared Binance hot wallet is not a ring |
| `ACTIVITY_IS_NOT_SYNCHRONISED` | wallets acting months apart, not in a burst |
| `PROTOCOL_USAGE_DIVERGES` | different protocol footprints, unlike a script |
| `INDEPENDENT_PRIOR_HISTORY` | 30+ days of history, unlike disposable ring wallets |

**Doubt is the strongest single finding, not the sum.** Four weak reasons are not one strong one, and summing would let marginal observations wash out a real coordination signal.

**No evidence yields `doubt: null`, never `0`.** Zero would read as "we checked and found nothing exculpatory" — a far stronger claim than "we had nothing to check."

---

## 3. Containment precedes understanding

§14.1 puts *freeze financial capability* **before** *launch investigation*, and the code keeps that order literally. An agent draining funds while a language model composes a paragraph is the exact failure this phase exists to prevent.

| severity | containment, before any investigation |
|---|---|
| `CRITICAL` | REVOKE (through the Phase 8 seam — real on-chain revocation for an ENS-backed agent) |
| `HIGH` | RESTRICT |
| `MEDIUM` / `LOW` | none |

Reversible by design: `RESTORE` exists for when the investigation clears the actor, and is legal **only** on `FALSE_POSITIVE`.

---

## 4. Two real bugs found

### A fail-open default I wrote

`severityRank` treats an unrecognised severity as `CRITICAL`, but my first draft of `initialMitigation` and `deterministicAction` both had `default:` returning the *permissive* branch — `NONE` and `ALLOW`. So a typo'd or newly-added severity would have gone **uncontained**, and worse, handed the model an `ALLOW` floor to agree with.

Caught by a test asserting the unknown case, fixed to fail closed in both. This is why the unknown-input case gets its own test rather than being assumed.

### `npm run worker` was already broken

The Temporal worker would not start — at Phase 10 **or at Phase 9's commit**:

```
ENOENT: no such file or directory, stat '.../src/workflow/workflows.js'
```

`worker.ts` hardcoded `./workflows.js`, but `npm run worker` runs the TypeScript sources through tsx, so that file does not exist and the bundler's `statSync` fails before the worker ever polls. After a build the reverse is true. Fixed by deriving the extension from `import.meta.url`.

I verified this was **pre-existing** by stashing my work and reproducing at `HEAD` — I did not break it. (My first attempt to check used `timeout`, which macOS does not ship, so the command silently failed and I briefly drew the wrong conclusion. Re-tested with a background PID and a kill.)

Worth flagging: the workflow suite passes because Temporal's test environment does its own bundling, so nothing caught that the *production* worker entrypoint was dead.

---

## 5. Files

| file | role |
|---|---|
| `src/incidents/incident-types.ts` | statuses, transitions, and §15.3's reconciliation — pure |
| `src/incidents/counter-evidence.ts` | the four deterministic counter-evidence checks |
| `src/incidents/incident-service.ts` | open → contain → investigate → decide → resolve |
| `src/workflow/incident.workflow.ts` | the durable §14.1 workflow |
| `scripts/check-incident.ts` | live end-to-end (`npm run check:incident`) |
| `test/incident-types.test.ts` | 19 pure tests |
| `test/v2-incident.db.test.ts` | 20 tests, real Postgres + real HTTP |

**Migration** `add_incident` adds `Incident` (§23's fields exactly) and extends `Investigation` with §15.1's structured finding — `hypothesis`, `supportingEvidenceIds`, **`contradictingEvidenceIds`**, `affectedRelationships`, `confidence`, `recommendedAction`.

`rootCause` stays null until stated, and closing an incident without one is refused: an incident closed with no cause taught nobody anything, and an empty string would look like one that had been examined.

**Routes:** `POST /v2/incidents`, `GET /v2/incidents`, `GET /v2/incidents/:id`, `POST /v2/incidents/:id/{investigate,mitigate,resolve,finding}`

---

## 6. Design decisions worth naming

- **Deduplication with escalation.** A Substreams stream re-firing every block must not create a thousand incidents; but deduplication must never mask a worsening situation, so a more severe repeat **escalates and re-contains** the existing incident.
- **A closed incident is terminal.** No transition out of `RESOLVED` or `FALSE_POSITIVE`. An incident log that can be rewritten is not an audit trail.
- **`MITIGATED` is not closed.** Contained is not explained.
- **The investigation has a deadline.** If no AI finding arrives, the workflow decides without one. A response that stalls because a model never answered is a response that failed — and the deterministic decision was always sufficient, since the AI can only tighten it.
- **`RESTORE` un-suspends only that actor's capabilities**, not everything they ever held, so one cleared incident cannot undo an unrelated Phase 7 trust suspension that is still valid.

---

## 7. Live proof

`npm run check:incident` — **19/19, exit 0**. The case is built deliberately as the Arbitrum shape: two wallets sharing a labelled exchange funder, acting months apart, on different protocols.

```
[OK]   labelled funder                  Binance 9 on mainnet (MEDIUM)
[OK]   found the Arbitrum defence       shared funder is a labelled exchange
[OK]   found divergent timing           wallets act months apart
[OK]   found divergent protocols        aave-v3 vs uniswap-v3
[OK]   doubt                            0.80 — Found 4 reason(s) to doubt coordination
[OK]   CONTAINED BEFORE INVESTIGATING   capability is SUSPENDED
[OK]   AI DE-ESCALATION REFUSED         applied RESTRICT, not ALLOW
[OK]   BOTH SIDES RECORDED              15 supporting, 15 contradicting
[OK]   citations are real rows          15 verified against EvidenceEvent
[OK]   overruled recommendation kept    recorded as ALLOW, not erased
[OK]   authority restored               capability is ACTIVE again
[OK]   closed incident is terminal      reopening refused
```

Real Temporal server, real worker, real capability enforcement.

---

## 8. Cumulative regression, Phase 0 → 10

| check | result |
|---|---|
| `npm test` × 6 | **663 passed, 5 skipped** — clean on 5 of 6 (624 → 663, +39) |
| `npm run typecheck` / `lint` | clean |
| `npm run check:incident` | 19/19 |
| `npm run check:x402` | 17/17 |
| `npm run check:enforcement` | 13/13 |

### An honest note on flakiness

One full-suite run out of six failed on a **Phase 5** test (`refuses to unfreeze into an expired assurance lease`), and a later isolated run failed a different Phase 5 test (`IS SINGLE USE, even after a failure`). Both sit on `/v2/agents/:id/verify`, which performs a **real Sepolia transaction** to mirror EAC roles; when that RPC hiccups the test fails.

This is **pre-existing and network-dependent**, not introduced by Phase 10 — the agent suite passed 4/4 in isolation and the failures do not reproduce deterministically. I did not paper over it. What I did change: the unfreeze test now asserts its precondition, so an RPC failure reports *"verify failed: …"* instead of a misleading `expected 200 to be 409` pointing at the wrong step.

Left as a known issue rather than silenced: with the project's no-mocks rule, the only honest fixes are a retry policy or a dedicated RPC endpoint, both of which belong in Phase 12's hardening.

---

## 9. Carried forward

- **The MCP investigator is not yet wired into the incident workflow.** The workflow accepts a finding by signal and the deterministic half runs, but nothing currently calls the V1 `startInvestigation` agent from an incident. The seam exists (`POST /v2/incidents/:id/finding`); connecting it is small and deliberate future work.
- **`notifyOperatorActivity` logs.** Named honestly rather than pretending to page anyone — Phase 11 gives Remote Authority a real channel.
- **Nothing opens incidents automatically yet.** Phase 7's trust mutation and Phase 8's enforcement failures are the obvious producers; today an incident is opened by an API call or a script.
- Earlier carry-forwards unchanged (no TrustSnapshot retention, no ENS renewal, ERC-7715 not implemented, x402 EVM-only).
