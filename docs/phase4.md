# Phase 4 — Temporal workflows

**Status:** Complete
**Date:** 2026-09-12
**Spec:** `Xander/xander-v2-backend.md` §33 Phase 4, workflows §14
**Goal:** Make long-running authorization durable.

**Done when:** *"A workflow can survive worker restart, wait for human input, receive a new signal, re-evaluate policy and complete correctly."* — met, and proven against a real Temporal server.

---

## 1. Why this phase exists

Through Phase 3, `/v2/intents` had to answer inside one HTTP request. A `CHALLENGE` could only *record* that assurance was needed — there was nowhere for the decision to live while a human took an hour to respond.

Phase 4 is that decision spread over time: waiting for a person, surviving a deploy, and **re-checking whether the answer still holds before acting on it**.

```
load trust → policy → [CHALLENGE] → WAIT for assurance
                                  → WAIT for a human
                                  → RE-EVALUATE
                                  → grant → receipt
```

---

## 2. What was built

| Piece | Purpose |
|---|---|
| `authorization.workflow.ts` | The §14.1 high-value flow, with signals and queries |
| `capability.workflow.ts` | Lease: wait expiry → re-check trust → renew / attenuate / revoke |
| `activities.ts` | All I/O. Calls the *same* trust and policy services the API does |
| `worker.ts` | Standalone worker process (`npm run worker`) |
| `temporal-client.ts` | Lazily-connected client |
| `shared.ts` | Signal/query definitions — the deterministic boundary |

Temporal runs in docker-compose on host port **7234** (off the default 7233, same reasoning as 5433/6380), reusing the Postgres we already run rather than standing up a second database.

**Signals** (§14.2): `APPROVE DENY LIMIT FREEZE UNFREEZE REVOKE EXTEND`, plus `assuranceCompleted` and `trustChanged`.

---

## 3. Decisions that matter

### 3.1 An operator cannot override a policy that blocks

The most important line in the phase. After the wait, policy is re-evaluated — and if it now says `BLOCK`, an operator `APPROVE` **does not** turn that into a grant.

A human is a gate *in addition to* policy, never a bypass of it (invariant 3.1). There's a test that approves a `CRITICAL`-band ring wallet and asserts the result is still `BLOCK` with no capability minted.

### 3.2 An operator can lower a ceiling but never raise one

`LIMIT` from an operator wins only when it's **stricter** than policy's. Approving an action is approving *that* action — not granting yourself the right to exceed the policy governing it.

### 3.3 A timeout is not an approval

Nobody answering resolves `REVIEW` with `APPROVAL_TIMED_OUT` and grants nothing. Section 27.5, fail closed.

### 3.4 Re-evaluation is the whole point of waiting

If assurance arrived, or trust moved, or a human decided — trust and policy are both recomputed before anything is granted. Approving against the picture we had an hour ago would authorise something nobody actually assessed. Section 30.4's "live trust change during wait" is a `trustChanged` signal, and it forces the re-check.

### 3.5 Activities call the same services as the API

There is no second implementation of trust or policy for the workflow path. That is exactly how the two would silently drift.

`evaluatePolicy` re-reads the live assurance lease itself rather than trusting a flag passed down — a lease can expire mid-wait, and "assurance completed an hour ago" is not the same as assurance being valid now.

### 3.6 The lease workflow attenuates before it revokes

At `UNCERTAIN` a capability is **halved**, not revoked. An actor who became merely ambiguous has done nothing wrong, and withdrawing all authority for ambiguity is the false-positive behaviour this project exists to avoid. `CRITICAL` / `HIGH_RISK` / `INSUFFICIENT_EVIDENCE` do end the lease.

Renewals are bounded — an unbounded loop grows workflow history until it must continue-as-new, and a lease nobody revisits is the standing authority §7.3 warns about.

---

## 4. Two things worth recording

### 4.1 TypeScript narrows signal-mutated variables to `never`

Control-flow analysis can't see that a Temporal signal handler assigns a closed-over variable, so it narrows it to `null` and every later branch to `never`. Reading through a function (`currentDecision()`) crosses a call boundary and returns the declared type. Non-obvious, and the error message points nowhere useful.

### 4.2 Time-skipping made the restart test meaningless

`TestWorkflowEnvironment.createTimeSkipping()` runs a **real** Temporal server with a controllable clock — that's how a one-hour approval timeout is tested in 645ms, and it's not a mock.

But it fast-forwards whenever nothing can make progress. Kill the worker and the harness cheerfully skips an hour, so "the worker was down" becomes indistinguishable from "the approval timed out" — my first restart test timed out at 240s for exactly this reason.

The restart test therefore runs against the **real docker Temporal** on wall-clock time. It's the only way "the worker was gone and it still worked" means anything. It skips gracefully if that server isn't up; everything else uses the time-skipping harness.

---

## 5. Verification

```
typecheck   clean
lint        clean
tests       490 passed | 5 skipped | 0 failed   (495 total, 35 files)
            three consecutive clean runs
```

Up from Phase 3.5's 480 → **+10 tests**. Still zero `vi.mock()`.

Section 30.4 coverage:

| Required case | Covered |
|---|---|
| workflow restart | ✅ real server, worker killed mid-wait |
| human approval timeout | ✅ 1h timeout in 645ms via time-skipping |
| live trust change during wait | ✅ `trustChanged` forces re-evaluation |
| revoke during pending action | ✅ operator `DENY`/`REVOKE` |
| freeze during pending action | ✅ lease workflow `REVOKE` wakes early |
| external verification retry | ✅ activity retry policy (5 attempts, backoff) |

**Not yet covered:** worker crash mid-activity (distinct from graceful shutdown), and approval arriving *after* the intent's own expiry. Both are honest gaps.

**The acceptance test, verbatim from the run:**
```
✓ THE ACCEPTANCE CONDITION: surviving a worker restart
  a parked workflow survives the worker dying and completes on a new one  4392ms
```

---

## 6. Files

**New:** `src/workflow/{shared,activities,authorization.workflow,capability.workflow,workflows,temporal-client,worker}.ts`, `test/workflow.db.test.ts`

**Modified:** `docker-compose.yml` (Temporal on 7234), `src/config/env.ts` (6 settings), `package.json` (4 `@temporalio` packages at 1.23.0, `npm run worker`)

No database schema change — `AuthorizationDecision.workflowId` already existed from Phase 1 and is now populated.

---

## 7. Carried forward

1. **Nothing starts these workflows yet.** `/v2/intents` still decides synchronously; no route hands a CHALLENGE to Temporal. Wiring that is a small change but a real product decision — which actions go durable — and belongs with Phase 11's control plane.
2. **The incident workflow is not built.** §14.1 lists three; this phase built two. Incidents are Phase 10's subject and the workflow belongs with them.
3. **Worker crash mid-activity is untested** — only graceful shutdown.
4. **Approval after intent expiry is untested** (§30.4 lists it).
5. **The suite now wants Temporal running.** It degrades to skipping one test if not, but `npm run infra:up` is now three containers.
