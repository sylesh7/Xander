# Sybil Shield

**A Graph-native, cross-protocol coordinated-actor risk engine, with World Selfie Check as a selective escalation layer.**

Sybil Shield sits in front of a token claim or DeFi incentive action. It builds a live evidence layer from **The Graph**, turns that evidence into a deterministic, explainable risk score per wallet/cluster, uses an AI investigation agent to explain *why* a cluster is flagged, and — only when risk crosses a threshold — escalates to **World ID Selfie Check** for a biometric liveness/uniqueness signal before the protocol allows, challenges, or blocks the claim.

Built for **ETHOnline 2026**, targeting two sponsor prizes:

| Track | Sponsor | Prize |
|---|---|---|
| Best Use of Composable or Standardized Graph Products | The Graph | $5,000 |
| Selfie Check | World | $7,000 pool (up to 3 teams, ~$1,166 each) |

---

## Table of contents

- [The problem](#the-problem)
- [The solution](#the-solution)
- [Market opportunity](#market-opportunity)
- [How it works](#how-it-works)
- [Claim flow — sequence diagram](#claim-flow--sequence-diagram)
- [The Graph — how each product is used](#the-graph--how-each-product-is-used)
- [World ID — Selfie Check as a selective signal](#world-id--selfie-check-as-a-selective-signal)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Build status](#build-status)
- [Running it locally](#running-it-locally)
- [Team](#team)

---

## The problem

Every major token airdrop or claim campaign of the last two years has had to fight the same battle at real scale, after the fact, with blunt tools:

- **LayerZero** flagged **over 800,000 sybil addresses** in its May 2024 crackdown, out of a pool of 1.28M wallets ultimately deemed eligible — and its CEO separately said up to 100,000 addresses self-reported as sybils under an amnesty program.
- **Linea's** 2025 airdrop sweep initially flagged **50.45%** of its 1,297,203 eligible wallets — over half — before refinement narrowed the actual exclusion down to 516,960 wallets (39.85%). That gap, ~137,000 wallets, is the cost of a detector with no auditable trail: nobody could tell a falsely-flagged user *why*, so the number had to be walked back after the fact.
- **Arbitrum's** 2023 anti-sybil mechanism used shared-funding-source clustering — the same signal this project uses — with no exclusion list for exchange/bridge/faucet addresses. The documented result: real users who happened to withdraw from the same hot wallet were restricted, while the actual sybils it was designed to catch mostly weren't.
- **LayerZero's** bounty-driven sybil-reporting program produced, by community accounts, "thousands of false positives... detected and forgiven in further lists" — a direct consequence of paying humans to flag addresses with no downstream audit.

The pattern across all four: **detection happens once, after the campaign, entirely inside the sponsor's backend, with no reasoning a flagged user or an outside reviewer can actually inspect.** A wallet is silently excluded or silently allowed, and the only appeal process is a forum thread.

Sybil Shield exists to fix the part of this that's actually fixable in a hackathon-sized backend: make every decision **provenance-backed and reproducible**, and reserve the invasive step — biometric verification — for the wallets that actually need it, not the entire eligible pool.

## The solution

1. **Evidence, not assumption.** Every fact behind a risk score — a transfer, a deposit, a borrow — is pulled live from The Graph and stored with its source, its deployment, and its block number attached. Nothing is inferred or fabricated.
2. **Deterministic scoring, not a black box.** Five named features (funding correlation, timing correlation, wallet-age similarity, shared-counterparty overlap, protocol-behavior similarity), each computed by an auditable formula, combined by weights stored in a database table — never a hardcoded number a judge (or a falsely-flagged user) can't inspect.
3. **A known-funder exclusion list, from day one.** The exact heuristic that misfired on Arbitrum — shared funding source — only counts as a signal here once the funder is checked against a seeded table of labeled exchange hot wallets, bridges, and faucets. This is the single most important lesson pulled directly from the airdrop precedents above.
4. **AI investigates, it doesn't decide.** When a cluster is flagged, an investigation agent (via The Graph's Subgraph MCP) explains *what* it found and *where it queried it from* — every claim in its report is checked against its own tool-call trace before being trusted. The number that gates the claim always comes from the deterministic scorer, never from the agent's prose.
5. **Biometric verification only for the wallets that need it.** World ID Selfie Check is never shown to a low-risk wallet. It appears exactly once risk crosses an explicit, config-driven threshold — turning an invasive step into a targeted one instead of a blanket gate applied to everyone.
6. **Fail closed, never fail open.** A stale Graph query, an unhealthy deployment, a timed-out World verification — none of these silently resolve to `ALLOW`. They resolve to `PENDING_REVIEW`. An unknown wallet is not a safe wallet.

## Market opportunity

- **Airdrop sybil defense is now a standing line item, not a one-off.** Arbitrum, Optimism, Linea, and LayerZero have each built or bought sybil detection at real scale in the last two years; the next wave of L2s, DeFi protocols, and points programs will need the same infrastructure, repeatedly, per campaign.
- **The status quo is a one-time, opaque, backend-only sweep.** None of the four precedents above give a flagged user a reason, and all of them were rebuilt from scratch per campaign. A reusable, provenance-first risk engine that any protocol can point at its own campaign is a real gap, not a hypothetical one.
- **The Graph's Standardized Subgraphs make "cross-protocol" tractable for the first time.** Before the Messari schema standard, detecting coordinated behavior across Aave, Compound, and a dozen other lending markets meant a custom adapter per protocol. One shared schema means one query pattern — this is the exact "standards leverage" the composability track rewards, and it's what turns a single-protocol sybil filter into a general-purpose one.
- **Selective biometric escalation is a better fit for real products than blanket verification.** A DeFi protocol asking every claimant for a face scan will lose legitimate users at the door. Gating it behind a real, explainable risk signal — this project's whole design — is the shape an actual production integration would need, not just a hackathon demo.

## How it works

```
   wallet submits a claim
            │
            ▼
   ┌─────────────────────┐
   │   Evidence layer     │  Token API + Standardized Subgraphs + Substreams
   │   (The Graph)         │  → normalized EvidenceEvent rows, provenance attached
   └─────────┬────────────┘
             ▼
   ┌─────────────────────┐
   │   Behavior graph &    │  funding correlation, timing, wallet age,
   │   clustering           │  shared counterparties, protocol-path similarity
   └─────────┬────────────┘
             ▼
   ┌─────────────────────┐
   │   Deterministic       │  weighted score, config-driven bands
   │   risk scoring         │  → ALLOW / CHALLENGE / BLOCK / PENDING_REVIEW
   └─────────┬────────────┘
             ▼
       score in CHALLENGE band?
       │                    │
       no                   yes
       │                    ▼
       │         ┌─────────────────────┐
       │         │  World ID Selfie      │  biometric liveness + uniqueness,
       │         │  Check (selective)     │  bound to this exact wallet + claim
       │         └─────────┬────────────┘
       │                   │
       ▼                   ▼
            final decision + full evidence trail
```
