# Phase 12 — Production hardening

**Status:** Complete — **final phase**
**Date:** 2026-09-12
**Spec:** §33 Phase 12, §26, §27, §28

**Done when (spec):** *"A failure in any external dependency produces a known safe state rather than an accidental authorization bypass."*

---

## 1. The acceptance condition, made testable

The operative word is **known**. It isn't enough that Xander happens to behave safely when The Graph is down — the behaviour has to be written down, enumerated per dependency, and checked.

`src/hardening/dependency-policy.ts` is that table: **12 dependencies**, each with a degraded behaviour, whether authorization can still be granted, a rationale, and the file where the behaviour actually lives.

| can still authorize | dependencies |
|---|---|
| **No** (7) | POSTGRES, GRAPH_TOKEN_API, GRAPH_SUBGRAPHS, SUBSTREAMS, WORLD, ENS_RPC, X402_FACILITATOR |
| Yes (5) | REDIS, SUBGRAPH_MCP, TEMPORAL, ERC8004_RPC, ANTHROPIC |

The five safe ones are all genuinely advisory: a cache, two AI paths, an advisory reputation registry, and a durability layer whose local effect has already been applied.

**There is deliberately no `IGNORE` behaviour.** Every value withholds or degrades something, because "carry on as if nothing happened" is the bypass the table exists to prevent.

The failure mode this guards against is specific: **a dependency that fails open is almost never obvious in review**, because the code that skips a check looks like the code that passes one. `test/dependency-policy.test.ts` walks every row and fails if a new integration ships without a policy, or if any row claims a dependency both influences authorization and is safe to lose.

Verified live by actually breaking one:

```
[OK]   baseline: enforcement confirms     confirmed by local
[OK]   WITHDRAWN AUTHORITY IS REFUSED     local: No capability for TRADE.
[OK]   UNKNOWN is not permission          section 18.2 holds
[OK]   no dependency fails open           every critical loss blocks authorization
```

---

## 2. Retention — closing a carry-forward from Phase 7

`TrustSnapshot` was append-only and nothing ever removed a row; one fixture actor had ~96 snapshots by Phase 8. Now there's a policy, and **two rules shape all of it**:

**Never delete an actor's most recent snapshot.** An authorization rests on it — deleting the last one makes the actor unmeasurable and turns a cleanup job into a mass denial of service. Tested with a single 5000-day-old snapshot: it survives.

**Never delete an audit trail on a schedule.** `OperatorAuditLog` keeps **730 days**; "who froze this agent and why" gets asked months later.

Snapshots are pruned **per actor** (newest 20, plus anything under 90 days) rather than by a global age cutoff — an actor evaluated a hundred times an hour and one evaluated twice a year both need their recent history.

`PendingAction` in `PENDING` is **never pruned at any age**: an unanswered action is a live obligation, and deleting it silently drops a decision somebody owes.

Seven tables are permanent and say so in code (`NEVER_PRUNED`), because "which tables are permanent?" is a security-review question that deserves an answer you can grep for.

`npm run retention` is a **dry run** unless you pass `--apply`.

---

## 3. Enforcement reconciliation

Xander's database and the chain are two records of the same authority and they can drift. The two directions are **not equally dangerous**:

| drift | urgency | why |
|---|---|---|
| `CHAIN_EXCESS` — chain grants more | **urgent** | public authority exists that Xander does not believe in |
| `CHAIN_MISSING` — database grants more | not urgent | the Phase 8 execution gate already refuses these |
| `UNREADABLE` | recorded | "we could not check" must never look like "we checked" |

**Repair is one-way and opt-in.** It only ever *revokes* an excess on-chain role — never grants — because a bug that dropped a capability locally must not be "repaired" into re-granting authority nobody re-authorised. And it defaults to a dry run: a reconciler that transacts unless told otherwise is one bad read away from a lot of gas.

Live against Sepolia: `Checked 30 action(s) across 5 agent(s); 3 drift(s), 0 urgent.`

---

## 4. Liveness ≠ readiness

Conflating these is a classic way to build an outage: a liveness probe that fails when Postgres is down restarts every replica in a loop while the database recovers.

- **`/health`** — "is this process alive?" Stays `ok: true` for a running server, exactly as it always has.
- **`/ready`** — "should I get traffic?" New. Probes Postgres, Redis and Temporal, and reports each **alongside its degradation policy**, so an operator sees not just "Redis is down" but what that means for authorization.

Both unauthenticated: a probe that needs a credential silently stops working the moment that credential rotates.

Readiness is **Postgres alone**. Everything else degrades to a defined safe behaviour, so draining traffic for them would cost availability without buying safety.

`/ready` deliberately does **not** probe the chain RPCs, the Graph or World — those cost quota or gas, and an endpoint scraped every few seconds must not burn a rate limit.

---

## 5. The rest of §33's list

| item | what shipped |
|---|---|
| **OpenTelemetry** | real SDK (`@opentelemetry/sdk-node` 0.222.0), auto-instrumentation, OTLP exporter; off by default, started before anything else so it can patch `http`/`pg`/`ioredis`. Request/response bodies are deliberately **not** traced — a span carrying a World nullifier would leak a credential into a system with different access controls. |
| **Rate limits** | upstream limiter (existing) + a control-plane limiter from Phase 11 |
| **Secrets rotation** | `BACKEND_API_KEYS_PREVIOUS` accepts old keys during an overlap window. Without an overlap, rotation means a flag-day across every client, which in practice means the key never gets rotated. Every candidate is compared **without an early exit**, so timing doesn't reveal which key matched. Empty entries are dropped — a blank would otherwise match a request sending no key. |
| **Database indexes** | §26 audited against Postgres; three added (below) |
| **Retention** | §2 above |
| **Backup/recovery** | `NEVER_PRUNED` defines what must survive; Postgres is a standard container with a volume — documented, not automated |
| **Worker autoscaling / Temporal HA** | graceful shutdown on SIGTERM/SIGINT with a 15s hard cap, plus `/ready` for draining |
| **Graph / World failure policy** | rows in the dependency table, both `canStillAuthorize: false` |
| **Enforcement reconciliation** | §3 above |
| **Webhook verification** | **not implemented — see §8** |
| **Security review** | `npm run check:hardening`, 29 checks |

### Indexes added

`§26` was mostly satisfied already. Three real gaps:

- **`EvidenceEvent(wallet, timestamp)`** — every trust rebuild and counter-evidence search is `wallet IN (...) ORDER BY timestamp`, and the bare `[wallet]` index made the planner sort by hand on the hottest path in the product.
- **`Wallet(clusterId)`** — "every wallet in this cluster" is asked on every clustered decision and had no index at all.
- **`Incident(status, severity, openedAt)`** — §26's exact composite, replacing two partial ones.

Asserted against `pg_indexes`, **not** the schema file: a migration written but never applied would pass a file check and fail here.

---

## 6. Two bugs I made and caught

**A vacuous index test.** My first version checked `indexdef.includes('"kind"')`, but Postgres only *quotes* identifiers that need it — `"actorId"` is quoted, bare `kind` is not. So the check matched nothing and every assertion passed against an empty set. Rewritten with a regex handling both forms, then verified by reading the real `indexdef` rows out of Postgres by hand.

**I reverted my own dependency install.** After breaking `package.json` with unescaped quotes in a `perl` edit, I ran `git checkout package.json` — which also reverted the OpenTelemetry dependencies added by `npm install --save` since the last commit. Caught by grepping for them afterwards rather than assuming. Reinstalled, and the inline-JS script that caused the mess became a real file (`scripts/retention.ts`).

---

## 7. Cumulative regression, Phase 0 → 12 (final)

| check | result |
|---|---|
| `npm test` × 3 consecutive | **749 passed, 5 skipped, 0 failed** (713 → 749, +36) |
| `npm run typecheck` / `lint` | clean |
| `npm run check:hardening` | **29/29** |
| `npm run check:control` | 17/17 |
| `npm run check:incident` | 19/19 |
| `npm run check:x402` | 17/17 |
| `npm run check:enforcement` | 13/13 |
| `check:graph` / `check:ens` / `check:erc8004` | all OK |

Test count across V2: **330 → 749**.

---

## 8. What is NOT done, stated plainly

- **Webhook verification (§27.4) is not implemented.** There is **no webhook receiver** in the codebase — Substreams uses a direct gRPC stream, not a callback. Building signature/timestamp/replay-window verification for an endpoint that does not exist would be ceremony, not security. If a webhook is ever added, §27.4's five requirements apply and this is the note that says so.
- **`ActorRelationship` does not exist.** §26 asks for indexes on it; the model was never built. Actor relationships are currently expressed through clusters.
- **`Wallet(address, chainId)`** cannot be created — `Wallet` has no `chainId` column, and `address` is the primary key. Changing it means touching a V1-locked model.
- **Backup/recovery is documented, not automated.** No scheduled dump, no restore drill.
- **Worker autoscaling** is graceful shutdown plus a readiness probe. There is no autoscaler config, because there is no deployment target yet.
- **OTel is off by default** and has never been pointed at a real collector.
- **ERC-7715** (Phase 8), **x402 non-EVM chains** (Phase 9), **MCP investigator not wired into the incident workflow** (Phase 10), **no push channel** (Phase 11) — all unchanged.
- **The MediaPipe capture UI still does not exist.** Backend liveness verification is complete and tested; nothing captures frames. This is the one thing standing between the backend and a live demo.
