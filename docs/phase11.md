# Phase 11 — Remote Authority

**Status:** Complete
**Date:** 2026-09-12
**Spec:** §33 Phase 11, §19, §14.2, §27.1, §27.2

**Done when (spec):** a mobile client can *view agent · view evidence · receive pending action · approve · limit · freeze* — **and the decision flows through the durable workflow.**

---

## 1. A human authority plane, not a remote desktop

§19 opens with the framing that drives everything here:

> The mobile app is not a remote desktop client. It is a **human authority plane**.

So the phone does not drive a UI. It issues **bound, single-use authority decisions** that flow into durable workflows. Every design choice below follows from that.

---

## 2. §19.2's eight requirements, each made real

| requirement | how |
|---|---|
| strong operator auth | a per-operator credential; the API key is **refused** |
| device/session binding | token **plus** `X-Device-Id`; either alone is useless |
| explicit action binding | a decision carries the action's `bindingHash` |
| short-lived tokens | 1-hour sessions by default |
| replay protection | a `@unique` nonce column, not check-then-insert |
| audit logging | written for **refusals** as well as successes |
| rate limiting | its own limiter on the whole control plane |
| World step-up | demanded for `REVOKE` and `FREEZE` when enabled |

### The API key is not an operator

§27.1: *"Do not reuse a static protocol API key as a mobile-user credential."* The key answers "is some backend calling?"; an operator answers "**which named human decided this?**" — and only the second can be held to an audit trail. `/v2/control` is mounted with its own middleware and a request bearing only `X-API-Key` gets a 401. There is a test and a live check for exactly that.

### Explicit action binding is the interesting one

`computeBindingHash` hashes the **immutable facts** of an action — type, subject, summary, amount. A decision must echo it back. So a decision captured while approving a **$10** payment cannot be replayed against an otherwise identical action for **$10,000**: different facts, different hash, refused.

Fields are joined with a `NUL` separator, so `{subjectId: "ab", summary: "c"}` and `{subjectId: "a", summary: "bc"}` cannot collide — a plain concatenation would make them identical. That has its own test.

### Two opposite defaults, both deliberate

- **An empty scope means unrestricted.** The only sensible default for a single-operator deployment.
- **An empty allow-list accepts nothing.** The opposite — because defaulting a malformed action to "anything goes" would make it *maximally* permissive.

Getting these the wrong way round is a privilege escalation, so both are stated in the code and tested.

### A scoped operator acting on an unnamed actor is refused

"No actor named" must not become "any actor". Otherwise an actor-scoped operator escapes their scope simply by omitting the field.

---

## 3. Freeze is a state transition (§19.3)

> Freeze is a capability state transition, not merely a UI flag.

`FREEZE` and `REVOKE` go through the same `agent-service` and Phase 8 enforcement paths as everything else — for an ENS-backed agent that means a **real on-chain transaction**, not a column update. Proven live:

```
[OK]   FREEZE IS A STATE TRANSITION   agent FROZEN, capability SUSPENDED
```

The direct `freeze` / `revoke` routes create a pending action and immediately decide it, rather than shortcutting. That keeps **one** path through the binding check, scope check, nonce and audit log — a second, less-guarded route to the most dangerous commands would be exactly the wrong thing to build.

---

## 4. Decisions reach the durable workflow (§14.2)

Mobile commands map to Temporal signals. Proven against a **real** parked workflow:

```
[OK]   workflow parked                phase AWAITING_OPERATOR
[OK]   DECISION REACHED THE WORKFLOW  operatorDecision signal delivered
[OK]   workflow saw the operator      awaiting operator; operator APPROVE by cmtymw4us...
```

Signalling is **best-effort and reported, never fatal**: the local capability change has already happened and *is* the enforcement. Letting a Temporal outage throw would roll back a real freeze because a workflow engine was unreachable — the wrong trade every time.

---

## 5. Credentials are never stored in the clear

- session tokens: only `sha256` in `tokenHash`, returned once at creation
- enrolment secrets: salted and iterated, per-operator salt

A leaked `Operator` table yields nothing usable, and two operators sharing a secret do not share a hash. A wrong secret and a nonexistent operator produce the **same message** and the same work, so valid operator ids cannot be enumerated by response or by timing.

---

## 6. Files

| file | role |
|---|---|
| `src/control/operator-auth.ts` | tokens, binding hash, session and scope checks — pure |
| `src/control/control-service.ts` | enrolment, sessions, pending actions, decisions, audit |
| `src/control/control-routes.ts` | the §19.1 surface with its own auth + rate limit |
| `scripts/check-control.ts` | live end-to-end (`npm run check:control`) |
| `test/operator-auth.test.ts` | 30 pure tests |
| `test/v2-control.db.test.ts` | 20 tests, real Postgres + real HTTP |

**Migration** `add_remote_authority` adds `Operator`, `OperatorSession`, `PendingAction`, `OperatorAuditLog`.

**Routes:** all nine from §19.1, plus `/v2/control/sessions` (open/close), `/v2/control/agents/:id/evidence` and `/v2/control/audit`.

---

## 7. Expiry is a refusal, not an approval

A pending action that nobody answered was never authorised. Reading the list expires stale actions **in place**, so the list and the database agree about what is still answerable — rather than filtering them out of the view while leaving them technically decidable.

---

## 8. Live proof

`npm run check:control` — **17/17, exit 0**, against the real app, real Temporal, real worker.

```
[OK]   API key is not an operator     401, as section 27.1 requires
[OK]   device binding holds           401 from another device
[OK]   binding mismatch refused       409
[OK]   replayed nonce refused         409
[OK]   audit records refusals too     6 entries, 2 denied
[OK]   closed session is dead         401
```

---

## 9. Cumulative regression, Phase 0 → 11

| check | result |
|---|---|
| `npm test` × 3 consecutive | **713 passed, 5 skipped, 0 failed** (663 → 713, +50) |
| `npm run typecheck` / `lint` | clean |
| `npm run check:control` | 17/17 |
| `npm run check:incident` | 19/19 |
| `npm run check:x402` | 17/17 |

### A failure I caused, and what it showed

An earlier regression pass had two failures in Phases 1 and 2. The cause was in the logs:

```
Can't reach database server at `localhost:5433`
```

I had **left the Temporal worker running in the background** after the live check, and it was competing for Postgres connections during the suite. My environment mistake, not a product defect — killing it gave three clean runs.

Worth recording what the failure actually looked like, because it is the system behaving correctly: with the database unreachable, the Phase 1 acceptance test got **`REVIEW` instead of `ALLOW`**. That is §27.5 fail-closed doing its job — an unreachable evidence store produces a hold, never a permissive decision.

---

## 10. Carried forward

- **No push channel.** The control plane is pull-based (`GET /v2/control/pending-actions`). A real mobile client wants a push notification; `notifyOperatorActivity` from Phase 10 still only logs.
- **Nothing raises pending actions automatically yet.** Phase 10's incidents and Phase 4's parked workflows are the obvious producers; today an action is raised by an API call.
- **Step-up is off by default** (`OPERATOR_STEP_UP_ENABLED=false`) because it needs a live World challenge per critical command. The code path is built and tested; enabling it is one env var.
- **No mobile client exists.** The spec asks that a mobile client *can* do these things — the backend exposes them. Building the app is out of scope for this phase.
- **Session cleanup** is lazy (expired on use). A sweeper belongs in Phase 12 alongside the retention policy.
- Earlier carry-forwards unchanged (ERC-7715 not implemented, x402 EVM-only, no TrustSnapshot retention, no ENS renewal, MCP investigator not yet wired into the incident workflow).
