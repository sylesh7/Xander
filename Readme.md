![Xander banner](frontend/public/assets/Xander_Banner.png)

**A Graph-native risk engine that grew into a full trust-and-authorization runtime for wallets and AI agents.**

Xander started as a claim-time sybil detector: pull live evidence from **The Graph**, turn it into a deterministic risk score, and escalate to **World ID Selfie Check** only for the wallets that actually need it. That engine — the "V1" Claim Gate — still runs today, unmodified, as one of four live API surfaces.

Built on top of it is a much larger system, "V2": every actor — wallet, human, or AI agent — gets a 7-dimension trust context built from real evidence, trust resolves to a scoped and expiring **capability** rather than a standing key, that capability is enforced at a real execution boundary (including a live on-chain **ENS** role check), agents carry real **ENS** identities and real **ERC-8004** on-chain reputation, can pay each other over a live **x402** flow, and any incident is investigated by an AI agent that can only *tighten* a decision, never loosen it, with a human operator holding final authority from a phone over a durable **Temporal** workflow.

Originally built for ETHOnline 2026. V1 targeted two sponsor prizes; V2 added a third, real ENSv2 integration on top of it:

| Track | Sponsor | Prize | Delivered in |
|---|---|---|---|
| Best Use of Composable or Standardized Graph Products | The Graph | $5,000 | V1 |
| Selfie Check | World | $3,500 pool (up to 3 teams, ~$1,166 each) | V1 |
| Best Use of ENSv2 | ENS | $4,500 pool (1st $1,500 · 2nd $1,500 · 3rd $1,000 · Runner-up $500) | V2 |

V1 (Phases 1–25) was built jointly by Suganthan and Sylesh for that hackathon. V2 (Phase 0 onward) is a solo continuation by Sylesh, built strictly *on top of* the shared V1 foundation rather than replacing it — the ENSv2 agent-identity work (Phases 3.5 and 5.5) is what makes the ENS track apply.

---

## Table of contents

- [What Xander is, today](#what-xander-is-today)
- [The problem](#the-problem)
- [V1 — the evidence & risk engine](#v1--the-evidence--risk-engine)
- [Claim flow — sequence diagram](#claim-flow--sequence-diagram)
- [V2 — the agent trust & authorization runtime](#v2--the-agent-trust--authorization-runtime)
- [V2 phase-by-phase](#v2-phase-by-phase)
- [The four API surfaces](#the-four-api-surfaces)
- [The Graph — how each product is used](#the-graph--how-each-product-is-used)
- [Try it live — query the deployed subgraph](#try-it-live--query-the-deployed-subgraph)
- [World ID — Selfie Check as a selective signal](#world-id--selfie-check-as-a-selective-signal)
- [ENS — agent identity is not agent authority](#ens--agent-identity-is-not-agent-authority)
- [ERC-8004 — reputation that refuses to be invented](#erc-8004--reputation-that-refuses-to-be-invented)
- [x402 — machine-payable, still policy-gated](#x402--machine-payable-still-policy-gated)
- [Temporal — durable workflows and human override](#temporal--durable-workflows-and-human-override)
- [Data model](#data-model)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Build status](#build-status)
- [Running it locally](#running-it-locally)

---

## What Xander is, today

Two systems, one shared database, one locked seam between them:

1. **The V1 Claim Gate** (`/screen-claim`, `/world/*`, `/claim/*`, `/clusters/*`, `/wallets/*`, `/investigations*`, `/campaigns/*`, `/receipts/*`) — a wallet submits a claim, evidence is pulled live from The Graph, a deterministic risk score decides `ALLOW` / `CHALLENGE` / `BLOCK` / `PENDING_REVIEW`, and World ID Selfie Check fires only on `CHALLENGE`.
2. **The V2 Trust Runtime** (`/v2/*`) — any actor (wallet, human, agent, or org) gets a trust context, a set of capabilities, and an enforcement boundary that checks those capabilities in real time, on-chain where it matters. Agents are human-backed, ENS-identified, ERC-8004-reputed, can transact over x402, and are watched by an incident-response system that can tighten their authority automatically and hand the final call to a human operator on a phone.

V2 was built strictly additively — every V1 route still works exactly as it did, and there's a test asserting the V1 `PENDING_REVIEW` decision maps to V2's `REVIEW`, never to `ALLOW`, wherever the two systems touch.

## The problem

Every major token airdrop or claim campaign of the last two years has had to fight the same battle at real scale, after the fact, with blunt tools:

- **LayerZero** flagged **over 800,000 sybil addresses** in its May 2024 crackdown, out of a pool of 1.28M wallets ultimately deemed eligible — and its CEO separately said up to 100,000 addresses self-reported as sybils under an amnesty program.
- **Linea's** 2025 airdrop sweep initially flagged **50.45%** of its 1,297,203 eligible wallets — over half — before refinement narrowed the actual exclusion down to 516,960 wallets (39.85%). That gap, ~137,000 wallets, is the cost of a detector with no auditable trail: nobody could tell a falsely-flagged user *why*, so the number had to be walked back after the fact.
- **Arbitrum's** 2023 anti-sybil mechanism used shared-funding-source clustering — the same signal this project uses — with no exclusion list for exchange/bridge/faucet addresses. The documented result: real users who happened to withdraw from the same hot wallet were restricted, while the actual sybils it was designed to catch mostly weren't.
- **LayerZero's** bounty-driven sybil-reporting program produced, by community accounts, "thousands of false positives... detected and forgiven in further lists" — a direct consequence of paying humans to flag addresses with no downstream audit.

The pattern across all four: **detection happens once, after the campaign, entirely inside the sponsor's backend, with no reasoning a flagged user or an outside reviewer can actually inspect.** A wallet is silently excluded or silently allowed, and the only appeal process is a forum thread.

The same failure mode reappears, worse, the moment the actor holding the wallet isn't a human at all. An AI agent that can move funds is usually given a key and told to behave in a system prompt — and a prompt is a suggestion, not a boundary. It takes one injected instruction, one stale-but-plausible piece of data, or one confused tool call, and a transaction the agent was never supposed to authorize is already signed. The model isn't malicious; it's obedient, and a guardrail that lives inside the same context window an attacker can write into was never actually enforcing anything.

Xander exists to fix the part of both problems that's actually fixable: make every decision **provenance-backed and reproducible**, reserve invasive steps — biometric verification, a human override — for the actors that actually need them, and never let an agent's own reasoning be the thing standing between it and money.

## V1 — the evidence & risk engine

1. **Evidence, not assumption.** Every fact behind a risk score — a transfer, a deposit, a borrow — is pulled live from The Graph and stored with its source, its deployment, and its block number attached. Nothing is inferred or fabricated.
2. **Deterministic scoring, not a black box.** Five named features (funding correlation, timing correlation, wallet-age similarity, shared-counterparty overlap, protocol-behavior similarity), each computed by an auditable formula, combined by weights stored in a database table — never a hardcoded number a judge (or a falsely-flagged user) can't inspect.
3. **A known-funder registry, so the Arbitrum heuristic can't misfire the same way.** Shared funding source — the exact signal that produced Arbitrum's false positives — is checked against a table of labeled exchange hot wallets and bridge contracts before it counts. Labelled and unlabelled funders are scored *separately* and the higher wins (`max(unlabelled, labelled × 0.15)`), so a benign shared funder is heavily down-weighted while a ring cannot launder a coordination signal by routing one extra transfer through an exchange. Seeded with 110 verified rows: 10 bridge contracts (first-party docs, HIGH) and 100 exchange hot wallets (MEDIUM, only addresses two independent label datasets agree on). `FAUCET` is deliberately empty — no faucet operator publishes its dispenser address, and inventing one would defeat the point.
4. **AI investigates, it doesn't decide.** When a cluster is flagged, an investigation agent (via The Graph's Subgraph MCP, through Mastra) explains *what* it found and *where it queried it from* — every claim in its report is checked against its own tool-call trace before being trusted. The number that gates the claim always comes from the deterministic scorer, never from the agent's prose.
5. **Biometric verification only for the wallets that need it.** World ID Selfie Check is never shown to a low-risk wallet. It appears exactly once risk crosses an explicit, config-driven threshold.
6. **Fail closed, never fail open.** A stale Graph query, an unhealthy deployment, a timed-out World verification — none of these silently resolve to `ALLOW`. They resolve to `PENDING_REVIEW`. An unknown wallet is not a safe wallet.

## Claim flow — sequence diagram

```mermaid
sequenceDiagram
    actor User as Wallet
    participant API as Claim API
    participant Graph as The Graph<br/>(Token API / Subgraphs / Substreams)
    participant Risk as Risk Engine
    participant MCP as Subgraph MCP<br/>investigation agent
    participant World as World ID<br/>Selfie Check

    User->>API: POST /screen-claim { wallet, campaignId }
    API->>Graph: fetch/refresh wallet evidence
    Graph-->>API: transfers, deposits, borrows... + block/deployment provenance
    API->>Risk: score(wallet, evidenceWindow)
    Risk->>Risk: cluster candidates, compute 5 features,<br/>weighted sum, map to band

    alt score is ALLOW or BLOCK
        Risk-->>API: decision + evidence trail
        API-->>User: 200 { decision, evidence }
    else score is CHALLENGE
        Risk-->>API: CHALLENGE, clusterId
        opt cluster flagged
            API->>MCP: investigate(clusterId, wallets)
            MCP->>Graph: schema-aware follow-up queries
            Graph-->>MCP: query results (checked against tool trace)
            MCP-->>API: evidence report (rejected if uncited)
        end
        API-->>User: 202 { decision: CHALLENGE, verificationChallenge }
        User->>API: POST /world/rp-signature { action }
        API-->>User: { sig, nonce, expiresAt }
        User->>World: open IDKit — Selfie Check (signal = wallet+claim)
        World-->>User: proof
        User->>API: POST /world/verify { rp_id, idkitResponse }
        API->>World: POST /api/v4/verify/{rp_id}
        World-->>API: verified proof (nullifier, signal_hash)
        API->>API: check nullifier not reused,<br/>signal_hash matches this wallet+claim
        API-->>User: final decision: ALLOW or BLOCK
    end

    Note over API,Graph: any stale/failed Graph query at any step<br/>→ PENDING_REVIEW, never a silent ALLOW
```

## V2 — the agent trust & authorization runtime

V2's thesis in one line: **a name is not an authorization, and a good reason is not a boundary.** Minting an identity for an actor grants zero capabilities by itself; authority only ever arrives through a separate, auditable trust/policy step, and once granted it is scoped, expiring, and re-checked continuously rather than handed over as a standing key.

The primitives, in the order they were built:

- **Actor + Intent** — every wallet, human, agent, or organization is an `Actor`; every attempted action is an `Intent` evaluated against that actor's current standing, producing an `AuthorizationDecision` and, if executed, an `ActionReceipt`.
- **Trust Context** — a 7-dimension vector (`behaviorIntegrity`, `coordinationRisk`, `historyStrength`, `humanAssurance`, `agentReputation`, `evidenceFreshness`, `investigationConfidence`), each dimension carrying a value *or* an explicit `UNKNOWN`/`NOT_APPLICABLE` state — **`null` never renders as `0`**, structurally, everywhere in the product. Six trust bands, including a dedicated `INSUFFICIENT_EVIDENCE` band for "we genuinely don't know yet," distinct from "we know and it's bad."
- **Capability + Policy** — policies are rows (`Policy`/`PolicyRule`, first-match-by-priority), not code. A grant can be a full `GRANT` or an `ATTENUATED_GRANT` — "reduce, don't refuse" — so a middling-trust actor gets a smaller allowance instead of a flat denial.
- **ENS agent identity** — every agent mints a real subname on a deployed Sepolia registry, carrying boolean EAC roles (who/what, not how much). Freezing or revoking an agent performs a real on-chain role revocation.
- **Human-backed agents + active liveness** — an agent's authority is backed by a human who passed World ID Selfie Check (`AssuranceLease`, 1h, `WORLD_ONLY`) and optionally an active liveness check via hand-geometry landmarks in the browser (extends the lease to 12h, `WORLD_PLUS_ACTIVE`). No biometric material is ever stored — only the pass/fail and the geometry check result.
- **ERC-8004 reputation** — `agentReputation` is read from three live Sepolia registries (Identity, Reputation, Validation) instead of being hardcoded `UNKNOWN`. Zero feedback stays `null`, never `0`.
- **Live trust mutation** — a new on-chain evidence event can attenuate, suspend, or revoke an *already-issued* capability in flight, based on the actor's resulting trust band. A first-ever evaluation, or an *improvement* in trust, never silently expands authority on its own.
- **Enforcement + the execution boundary** — every applicable enforcement adapter (a local DB check, a real on-chain ENS/EAC role check) must positively confirm before an action is treated as authorized. The outcome is three-valued — `CONFIRMED` / `FAILED` / `UNKNOWN` — and an unreachable boundary is `UNKNOWN`, which blocks exactly like `FAILED` does.
- **x402 agent commerce** — agents pay each other over a real Base Sepolia USDC (EIP-3009) flow, protocol v2. A policy-denied agent gets `403`; a genuinely payable request gets `402`. Every outcome, including refusals, is written to a payment ledger.
- **AI security operations** — an `Incident` opens automatically on coordination detection, trust collapse, enforcement failure, assurance lapse, or anomalous velocity. Containment (revoke/restrict) happens *before* an AI investigation ever runs. The investigator's recommendation can only *tighten* the standing decision, never loosen it (`reconcileRecommendation`), and an overruled recommendation is recorded, not erased.
- **Remote Authority** — a mobile control plane for a human operator: approve, deny, limit, freeze, unfreeze, revoke, or extend, each decision bound to the operator's device and a single-use nonce so it can't be replayed. `HIGH`/`CRITICAL` incidents auto-raise a pending action for a human to see.
- **Production hardening** — a dependency-policy table enumerates every external dependency and states whether losing it blocks authorization or degrades safely; **no dependency is permitted an `IGNORE` value.** A reconciliation pass compares on-chain state to the database and treats "chain shows *more* authority than the DB thinks" as an urgent, revoke-only repair. `/ready` is a distinct, per-dependency readiness probe from `/health`.

## V2 phase-by-phase

| Phase | What it added |
|---|---|
| **V2 Phase 0** — Stabilize V1 | Known-funder registry, fixture-freshness re-stamping, port remap to coexist with other local projects (5433/6380). |
| **V2 Phase 1** — Actor + Intent | `Actor`, `ActorIdentity`, `Intent`, `AuthorizationDecision`, `ActionReceipt`. V1→V2 decision mapping. |
| **V2 Phase 2** — Trust Context | The 7-dimension vector, 6-band derivation, append-only `TrustSnapshot`/`TrustSignal`, drift detector (signal only, never a verdict). |
| **V2 Phase 3** — Capability + Policy | Rules-as-rows policy engine (18 seeded rules), `Capability`/`CapabilityUsage`/`AssuranceLease`, attenuated grants. |
| **V2 Phase 3.5** — ENSv2 identity + EAC | Real Sepolia deployment: parent `xander.eth`, own `PermissionedRegistry`, first agent subnames. |
| **V2 Phase 4** — Temporal workflows | Durable authorization/capability workflows, operator signals, Temporal + Web UI running locally. |
| **V2 Phase 5** — Human-backed agents + liveness | `Agent`/`LivenessChallenge` models, agent lifecycle state machine, hand-geometry active liveness. |
| **V2 Phase 5.5** — ENS wired into agent creation | Agent creation mints a real subname; freeze/revoke perform real on-chain role revocation. |
| **V2 Phase 6** — ERC-8004 agent trust | `agentReputation` reads live registries instead of being hardcoded `UNKNOWN`. |
| **V2 Phase 7** — Live trust mutation | New evidence can attenuate/suspend/revoke an already-issued capability. |
| **Phase 8** — Enforcement + execution boundary | Local + ENS/EAC enforcement adapters, three-state outcome, real `ActionReceipt.executionStatus`. |
| **Phase 9** — x402 agent commerce | Real Base Sepolia USDC payment flow, protocol v2, refusal vs payment-required kept distinct. |
| **Phase 10** — AI security operations | `Incident` model, counter-evidence checks, contain-before-investigate, AI can only tighten. |
| **Phase 11** — Remote Authority | Mobile operator control plane, device-bound + replay-proof decisions, auto-raised pending actions. |
| **Phase 12** — Production hardening | Dependency-policy table (no `IGNORE`), retention policy, chain/DB reconciliation, `/ready`, OpenTelemetry (off by default). |

Full detail for every phase lives in `docs/phase0.md` through `docs/phase12.md` (plus `docs/phase3.5-ens.md`), with `docs/backendwiring.md` as the single "how to call any of this" reference and `docs/frontendfinal.md` as the frontend build spec. The V1-era `backend/docs/` files (`API-CONTRACT.md`, `EVIDENCE-RISK-INTERFACE.md`, `PROGRESS-SUGANTHAN.md`, `PROGRESS-SYLESH.md`, `RISK-MODEL.md`) remain accurate for the V1 layer specifically and are worth keeping as the record of *why* the original risk model works the way it does — they're just no longer a complete picture of the whole system on their own.

## The four API surfaces

One server, four routers, **three different auth models** — mixing them up is the single biggest source of confusing 401s in this codebase.

| # | Surface | Prefix | Auth | Notes |
|---|---|---|---|---|
| 1 | **V1 Claim Gate** | `/screen-claim`, `/world/*`, `/claim/*`, `/receipts/*`, `/clusters/*`, `/wallets/*`, `/investigations*`, `/campaigns/*` | `X-API-Key` | Rate-limited on routes that spend Graph/World quota |
| 2 | **V2 Trust Runtime** | `/v2/*` (except `/v2/control/*`) | `X-API-Key` | Actors, Intents, Agents, Liveness, Incidents |
| 3 | **x402 commerce** | `/x402/*` | **none** — payment is the auth | `GET /x402/info`, `/risk-report`, `/payments/:actorId` |
| 4 | **Remote Authority** | `/v2/control/*` | `Authorization: Bearer` + `X-Device-Id` | API key is explicitly rejected (401) here — tested. 60 req/min. |
| — | **Probes** | `/health`, `/ready` | none | `/health` is always `ok:true` while the process runs; `/ready` is the real 200/503 readiness check |

`x402Router` and `controlRouter` are mounted **before** the V1 router in `server.ts`, because the V1 router applies its API-key middleware with no path prefix — any unauthenticated route added after it would silently inherit that requirement.

Representative routes: `POST/GET /v2/actors`, `GET /v2/actors/:id/{trust,trust/history,capabilities,enforcement}`, `POST/GET /v2/intents`, `POST /v2/intents/:id/execute`, `POST /v2/agents`, `GET/POST /v2/agents/:id`, `POST /v2/agents/:id/{verify,freeze,unfreeze,revoke,erc8004}`, `POST /v2/verification/liveness/{start,complete}`, `POST/GET /v2/incidents`, `POST /v2/incidents/:id/{investigate,mitigate,resolve,finding}`, `POST/DELETE /v2/control/sessions`, `GET /v2/control/agents`, `POST /v2/control/actions/:id/{approve,deny,limit}`, `POST /v2/control/agents/:id/{freeze,revoke}`, `GET /v2/control/audit`.

## The Graph — how each product is used

The Graph is the evidence layer for the entire product, V1 and V2 alike. Four of its products are composed into one pipeline, driven by **one schema-family query pattern reused across every protocol supported**:

| Product | Role in Xander | What it answers |
|---|---|---|
| **Token API** | Historical wallet-level evidence (REST) | Who funded this wallet, when, from how many sources, when did it first appear on-chain |
| **Standardized Subgraphs** | Cross-protocol DeFi behavior (GraphQL, one query per schema family — Messari lending-cdp, dex-amm, yield-aggregator) | Has this wallet borrowed, supplied, swapped, or farmed — across *any* protocol tagged into that schema family, with zero protocol-specific code |
| **Substreams** | Real-time streaming ingestion (Rust/WASM module → gRPC) | New funding transfers and claim events, as they happen, with cursor-resumable, reorg-safe delivery |
| **Subgraph MCP** | AI investigation agent, via Mastra | When a cluster is flagged (V1) or an incident opens (V2), what shared behavior actually explains it — with every claim checked against the agent's own real tool-call trace before being trusted |

The `DeploymentRegistryEntry` table is the single place "which protocols we support" lives — adding a new lending protocol is an `INSERT`, never a code change.

**A fifth Graph product is deployed as a standalone, directly-queryable artifact**: a real **Subgraph Studio** subgraph (`xander`), indexing live Base Sepolia USDC `Transfer` events, deployed and synced end-to-end at **`v0.0.3`** — see [Try it live](#try-it-live--query-the-deployed-subgraph) below, or `backend/docs/EVIDENCE-RISK-INTERFACE.md` §11 for its full build/query story.

## Try it live — query the deployed subgraph

The `xander` subgraph is deployed and fully synced on **Base Sepolia** at **`v0.0.3`**. No setup needed:

**GraphiQL playground:** [`https://api.studio.thegraph.com/query/1758823/xander/v0.0.3`](https://api.studio.thegraph.com/query/1758823/xander/v0.0.3)
**Studio page:** [`https://thegraph.com/studio/subgraph/xander`](https://thegraph.com/studio/subgraph/xander)

```graphql
{
  _meta {
    block {
      number
    }
  }
  transfers(first: 5, orderBy: blockNumber, orderDirection: desc) {
    id
    from
    to
    value
    blockNumber
    blockTimestamp
    transactionHash
  }
}
```

Or query it directly from a terminal:

```bash
curl -s -X POST https://api.studio.thegraph.com/query/1758823/xander/v0.0.3 \
  -H "Content-Type: application/json" \
  -d '{"query":"{ _meta { block { number } } transfers(first:5, orderBy: blockNumber, orderDirection: desc) { id from to value blockNumber } }"}'
```

The proxy-admin events the scaffold originally indexed are also queryable:

```graphql
{
  adminChangeds(first: 5) { id previousAdmin newAdmin blockNumber }
  upgradeds(first: 5) { id implementation blockNumber }
}
```

## World ID — Selfie Check as a selective signal

World ID Selfie Check (Beta, via `@worldcoin/idkit-core`) is used as the escalation step wherever biometric assurance is actually earned — a `CHALLENGE`-band claim in V1, or establishing an agent's human backing in V2. It never decides anything on its own; it adds one more signal to a decision another system already made.

- **RP-signature step, backend-only.** Every verification request is signed server-side (`signRequest`, using a secret `signing_key` that never reaches the client) before the client can even open IDKit.
- **Wallet/actor + action binding.** The proof's `signal` is bound to `hash(actor, action)` — not the wallet or agent alone — so a completed proof can't be lifted from one flagged claim (or one agent) onto another.
- **Replay protection.** Every proof's `nullifier` (a 256-bit integer) is stored and checked for reuse against `(nullifier, action)` before anything is allowed to resolve.
- **Fail closed.** A timed-out or invalid World verification never falls through to an approval — it holds the claim, or withholds the assurance lease, exactly like a failed Graph query does.

A real phone running the real World App completed a real Selfie Check that this backend's verification logic accepted, bound to the correct wallet and claim.

Track qualification feedback (docs/integration flow, Developer Portal, sandbox behavior, and every point of real confusion hit while building this) is written up in full at [`WORLD-FEEDBACK.md`](WORLD-FEEDBACK.md).

## ENS — agent identity is not agent authority

Every V2 agent gets a real, on-chain identity: a subname minted under a parent domain (`xander.eth`) on a dedicated **ENSv2** `PermissionedRegistry` deployed on Sepolia, carrying boolean **EAC** (Extended Access Control) roles — *who* an agent is and *what category* of role it holds, deliberately not *how much* it's authorized to do.

The rule this integration is built around: **minting an identity grants zero capabilities.** Authority comes only from the separate trust/policy path described above. What ENS *does* control is real:

- Creating an agent (V2 Phase 5.5 onward) mints `<label>.xander.eth` for real.
- Freezing or revoking an agent performs a **real on-chain role revocation** on the deployed registry, not just a database flag.
- The database stays authoritative for security decisions; the chain is a public, independently-checkable mirror of them. A reconciliation pass (Phase 12) treats the chain showing *more* authority than the database as an urgent, revoke-only drift to repair — never the other way around.

## ERC-8004 — reputation that refuses to be invented

`agentReputation`, one of the seven trust dimensions, is read from three live, cross-verified registries deployed on Sepolia (Identity, Reputation, Validation — the Reputation and Validation contracts are checked to both point back at the same Identity registry, proving they're one matched deployment rather than three unrelated addresses). The deployed contracts diverge from the EIP draft in shape (`bytes32` tags rather than `string`, a 2-value rather than 3-value `getSummary`), so the client is written against what's actually on-chain.

An agent with no feedback and no validations returns `null` for this dimension — never a synthetic `0` or `1`. Where both exist, validations are weighted over feedback (0.6 / 0.4): a validation is a check a validator contract actually performed, while feedback is an opinion anyone can post.

## x402 — machine-payable, still policy-gated

Agents can pay each other in real **Base Sepolia USDC** over the **x402 protocol v2** (wire-incompatible with v1 — the live `x402.org` facilitator only speaks v2, and the client is built against that). Payment moves via an EIP-3009 authorization to a receive-only recipient address Xander never holds the key for.

The distinction the product is careful never to blur: a policy-denied agent gets **`403`** (refused, no amount of money changes that), while a genuinely payable action gets **`402`** (payment required — not an error). Every outcome, including refusals, is written to an `X402Payment` row, and rate limits for paying agents live as ordinary `PolicyRule` rows rather than a separate system.

## Temporal — durable workflows and human override

Authorization, capability mutation, and incident response all run as **Temporal** workflows (`@temporalio/*`), not as fire-and-forget request handlers — so an operator's `APPROVE` / `DENY` / `LIMIT` / `FREEZE` / `UNFREEZE` / `REVOKE` / `EXTEND` signal is durable even if the process restarts mid-decision. An operator can tighten an outstanding decision but can never override an already-issued `BLOCK`. Temporal runs locally via Docker (host port 7234), with the Temporal Web UI on port 8233 for browsing workflow histories directly.

## Data model

~33 Prisma models in one shared `schema.prisma`, grouped by what they're for:

| Group | Models |
|---|---|
| V1 evidence/risk | `DeploymentRegistryEntry`, `PolicyVersion`, `RiskWeight`, `RiskThreshold`, `Wallet`, `Cluster`, `EvidenceEvent`, `RiskEvidence`, `SubstreamsCursor`, `KnownFunderAddress` |
| V1 claim/World/investigation | `Claim`, `VerificationChallenge`, `EvidenceReceipt`, `Investigation` |
| V2 actor/intent | `Actor`, `ActorIdentity`, `Intent`, `AuthorizationDecision`, `ActionReceipt` |
| V2 trust | `TrustSnapshot`, `TrustSignal` (both append-only) |
| V2 capability/policy | `Policy`, `PolicyRule`, `Capability`, `CapabilityUsage`, `AssuranceLease` |
| V2 agent identity | `Agent`, `LivenessChallenge` |
| V2 commerce | `X402Payment` |
| V2 incidents | `Incident` |
| V2 remote authority | `Operator`, `OperatorSession`, `PendingAction`, `OperatorAuditLog` |

Key state values (stored as validated strings, not native Postgres enums, so a new value is a data change rather than a migration):

```
TRUST_BANDS    = VERIFIED_LOW | ESTABLISHED_LOW | UNCERTAIN | HIGH_RISK | CRITICAL | INSUFFICIENT_EVIDENCE
V1 DECISIONS   = ALLOW | CHALLENGE | BLOCK | PENDING_REVIEW
V2 DECISIONS   = ALLOW | LIMIT | CHALLENGE | REVIEW | BLOCK
AGENT_STATUSES = DRAFT | VERIFYING | HUMAN_BACKED | ACTIVE | RESTRICTED | FROZEN | REVOKED
CAPABILITY_STATUS = ACTIVE | EXPIRED | REVOKED | SUSPENDED
EXECUTION_STATUS  = NOT_EXECUTED | EXECUTED_AS_AUTHORIZED | BLOCKED_UNENFORCEABLE | FAILED
INCIDENT_STATUSES = OPEN | INVESTIGATING | MITIGATED | FALSE_POSITIVE | RESOLVED
DIMENSION_STATES  = KNOWN | UNKNOWN | NOT_APPLICABLE
```

Note the deliberate V1/V2 decision-set mismatch: V1's `PENDING_REVIEW` maps to V2's `REVIEW`, never to `ALLOW`, anywhere the two systems meet.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+, TypeScript (strict) |
| API | Express + `zod` |
| Database | PostgreSQL + Prisma |
| Queue/cache | Redis + BullMQ |
| Durable workflows | Temporal (`@temporalio/{activity,client,worker,workflow}`), local Web UI on 8233 |
| Graph — historical data | Token API (REST, thin typed `fetch` wrapper) |
| Graph — cross-protocol data | Standardized Subgraphs via `graphql-request` against the gateway |
| Graph — real-time | Substreams — Rust/WASM module, `@substreams/core` + `@connectrpc/connect-node` Node bridge |
| Graph — AI investigation | Subgraph MCP via Mastra (`@mastra/core`, `@mastra/mcp`) |
| Identity escalation | World ID 4.0 Selfie Check via `@worldcoin/idkit-core` |
| Agent identity | ENSv2 + EAC roles, via `viem` direct contract calls (no dedicated ENS SDK) |
| Agent reputation | ERC-8004 Identity/Reputation/Validation registries, via `viem` |
| Agent commerce | x402 protocol v2, hand-rolled client against the live `x402.org` facilitator |
| Active liveness | Hand-geometry landmark verification server-side; MediaPipe (`@mediapipe/tasks-vision`) client-side in the frontend |
| Observability | pino structured logging, OpenTelemetry (`@opentelemetry/*`, off by default), provenance-aware `/health` + `/ready` |
| Frontend | Next.js 15 (App Router), React 19, TypeScript |
| Testing | vitest + supertest, zero `vi.mock()` module mocks anywhere in the suite |

## Repository layout

```text
Xander/
├── Readme.md
├── docs/                          # V2 phase docs (phase0.md … phase12.md, phase3.5-ens.md),
│                                   #   backendwiring.md (API reference), frontendfinal.md (FE spec)
├── backend/                       # the shared backend project
│   ├── src/
│   │   ├── graph/                 # Token API, Standardized Subgraphs, Substreams clients
│   │   ├── evidence/              # normalizer + repository (V1)
│   │   ├── behavior-graph/        # clustering (V1)
│   │   ├── risk/                  # feature extractors, scoring, policy (V1)
│   │   ├── provenance/            # freshness guard + /health (V1)
│   │   ├── claim/                 # V1 Claim Gate routes + orchestrator
│   │   ├── world/                 # World ID RP-signature, verify, replay protection
│   │   ├── interfaces/            # the Suganthan -> Sylesh seam (V1)
│   │   ├── actor/, intent/        # V2 Actor + Intent foundation
│   │   ├── trust/                 # V2 7-dimension trust context, drift, mutation
│   │   ├── capabilities/          # V2 Capability + AssuranceLease
│   │   ├── authorization/         # policy evaluator, rule engine, enforcement adapters
│   │   ├── agents/, ens/          # V2 agent lifecycle, ENSv2 identity, EAC roles
│   │   ├── verification/          # V2 active liveness
│   │   ├── x402/                  # V2 agent commerce
│   │   ├── incidents/             # V2 AI security operations
│   │   ├── control/               # V2 Remote Authority control plane
│   │   ├── workflow/              # V2 Temporal workflows, activities, worker
│   │   ├── hardening/             # V2 dependency policy, reconciliation, retention
│   │   └── v2/                    # V2 route aggregator
│   ├── prisma/schema.prisma       # the shared, locked schema (~33 models)
│   ├── substreams/                # the real Rust/WASM Substreams module
│   ├── scripts/                   # check:* live-verification scripts, ENS deploy scripts
│   ├── docs/                      # V1-era: API-CONTRACT.md, EVIDENCE-RISK-INTERFACE.md,
│   │                               #   PROGRESS-SUGANTHAN.md, PROGRESS-SYLESH.md, RISK-MODEL.md
│   └── test/
├── frontend/                      # Next.js console + mobile Remote Authority app
│   └── app/
│       ├── console/                # actors, agents, intents, incidents, commerce, policy, evidence, system
│       └── authority/              # mobile operator: login, pending queue, decide screen
└── xander-subgraph/                # standalone Subgraph Studio deployment (Base Sepolia USDC)
```

## Build status

**V1 — Evidence & Risk Engine + Claim Gate: done, verified live.** Real Token API, Standardized Subgraphs (4+ live deployments across 2 chains), and Substreams (live Base Sepolia stream, cursor-resume and reorg both proven, 1,521 real events in one verified run) integrations. A live, synced Subgraph Studio deployment (`xander`, Base Sepolia) indexing real USDC `Transfer` events. A real phone completed a real World ID Selfie Check that this backend accepted end to end.

**V2 — Trust & Authorization Runtime: all 13 phases (0 through 12) done, solo, built strictly on top of V1.**

- Real, deployed, live-verified integrations at every layer: ENSv2 registry and agent subnames on Sepolia, three cross-verified ERC-8004 registries on Sepolia, a real Base Sepolia USDC x402 payment flow, Temporal running real durable workflows with a real Web UI.
- Enforcement is real, not simulated: a frozen or revoked agent loses its role on-chain, not just in the database, and a reconciliation pass treats any drift where the chain shows more authority than the database as urgent.
- The AI investigation agent is structurally prevented from loosening a decision (`reconcileRecommendation` only ever tightens); a human operator holds final authority from a phone over a device-bound, replay-proof channel.
- Every external dependency is enumerated with an explicit block-or-degrade policy — no dependency is permitted to silently be ignored.

**Test suite: 749 passing** (final count, Phase 12), climbing monotonically from 330 at the V1/V2 boundary through every phase, with **zero `vi.mock()` module mocks anywhere** — a deliberately maintained discipline; removing the two mocks that once existed in the V1 suite is what surfaced two real bugs along the way.

**Known, explicitly-flagged gaps** (not hidden, called out in the phase docs themselves): ERC-7715 is not implemented (needs a browser wallet session); there is no webhook receiver, so webhook signature verification has nothing to verify yet; the Remote Authority mobile plane is poll-only (3–10s), no push channel; the incident investigator isn't yet wired to auto-trigger from every incident type; ENS agent names expire in 30 days with no renewal job; x402 is EVM-only despite the facilitator advertising other chains. The risk model and V2 policy are both explicitly a configurable demo policy, not a model validated against labelled sybil data — that honesty framing is intentional and preserved here on purpose.

## Running it locally

### Backend

```bash
cd backend
cp .env.example .env      # fill in credentials as they arrive
npm install
npm run infra:up          # postgres:16 (5433), redis:7 (6380), temporal (7234), temporal-ui (8233)
npm run db:migrate
npm run db:seed
npm run dev                # http://localhost:3000/health -> { ok: true, provenance: {...} }
npm run worker              # separate process: the Temporal worker for authorization/capability/incident workflows
npm run typecheck && npm run lint && npm test
```

Postgres and Redis are deliberately mapped off their default host ports (5433 and 6380, not 5432/6379) so the stack runs alongside other local projects without a port clash. The ports appear in `docker-compose.yml`, `.env`, `.env.example`, and `vitest.config.ts` (which sets its own `DATABASE_URL`/`REDIS_URL` independent of `.env`) — a mismatch between them shows up as a Prisma authentication error in the DB tests.

If a fixture wallet unexpectedly resolves `PENDING_REVIEW`, it is almost certainly the 6-hour evidence-freshness window rather than a regression — fixture rows are deduplicated on re-seed and keep their original `createdAt`. Fix it with:

```bash
npm run db:seed:refresh   # re-stamps fixture evidence as freshly fetched
```

Live-verification commands (real credentials, real data, not from memory):

```bash
npm run check:graph          # Token API + Standardized Subgraphs + Substreams, live
npm run check:verdict        # full V1 pipeline against real evidence -> ALLOW/CHALLENGE/BLOCK
npm run check:mcp            # Subgraph MCP connection
npm run check:investigation  # a real grounded investigation run
npm run check:ens            # ENSv2 registry reachability
npm run check:agent-ens      # agent subname mint/resolve
npm run check:erc8004        # the three cross-verified registries
npm run check:enforcement    # local + ENS/EAC enforcement adapters
npm run check:x402           # real Base Sepolia USDC payment flow
npm run check:incident       # incident lifecycle end to end
npm run check:control        # Remote Authority auth + pending-action flow
npm run check:hardening      # dependency-policy + reconciliation
npm run substreams:pack && npm run substreams:run   # live Base Sepolia stream
```

### Frontend

```bash
cd frontend
npm install
echo "NEXT_PUBLIC_API_BASE_URL=http://localhost:3000" > .env.local
npm run dev                # http://localhost:3000 (Next.js dev port, separate from the backend's :3000 — override PORT on one side)
```

The console (`/console/*`) uses the same `X-API-Key` as the backend's V1 + V2 surfaces; the mobile Remote Authority app (`/authority/*`) authenticates separately via `Authorization: Bearer` + `X-Device-Id` and never sends the API key.

