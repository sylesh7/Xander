---
name: sybil-shield-graph
description: Verified integration facts for The Graph in the Sybil Shield backend — Token API REST endpoints, the Standardized Subgraphs gateway URL, Messari lending schema entity names, Substreams crates and manifest shape, the substreams sink packages, and Subgraph MCP. Use when writing or debugging anything under src/graph/, when building the deployment registry, when writing GraphQL queries or the Substreams Rust module, or whenever tempted to guess a Graph package name, endpoint, or entity name.
---

# The Graph — confirmed integration facts

Everything here was verified against live documentation during the spec review
(Sept 2026) and is recorded in `Backend-Suganthan.md` / `Backend-Sylesh.md`.
**Prefer these over recall.** If something you need is not listed here, pull it
from the live docs and add it — do not guess a name.

## Token API (Phase 3 — historical wallet evidence)

REST. Bearer JWT on every request; **there is no unauthenticated tier**.

```
GET https://token-api.thegraph.com/v1/evm/balances?network=mainnet&address=0x...
GET https://token-api.thegraph.com/v1/evm/transfers?network=mainnet&address=0x...
GET https://token-api.thegraph.com/v1/evm/tokens?network=mainnet&contract=0x...

Headers:
  Accept: application/json
  Authorization: Bearer <GRAPH_MARKET_API_TOKEN>
```

**There is no official Token API Node/TypeScript SDK.** Two independent research
passes confirmed this. Write a thin authenticated `fetch` wrapper — that is the
permanent answer, not a stopgap waiting for an SDK that does not exist. Do not
import a package that claims to be one.

`network` is one of The Graph's supported network IDs. Load the supported list
from config; never a hardcoded `switch`.

## Standardized Subgraphs (Phase 4 — cross-protocol DeFi)

GraphQL. Query URL pattern, confirmed exactly:

```
https://gateway.thegraph.com/api/{GRAPH_GATEWAY_API_KEY}/subgraphs/id/{deploymentId}
```

`deploymentId` is the `Qm...` id from Graph Explorer — **never the display name**.
A wrong or stale deployment id silently returns nothing useful.

**Confirmed entity names, Messari standardized lending schema** (`lending-cdp`
family — spans Aave, Compound, MakerDAO, Spark, Venus and dozens more across
Ethereum, Polygon, Arbitrum, Avalanche, BSC, Optimism, Base):

```
lendingProtocols, markets, accounts, positions,
deposits, borrows, repays, withdraws, liquidates, flashloans,
financialsDailySnapshots, marketDailySnapshots, usageMetricsDailySnapshots
```

**`dex-amm` and `yield-aggregator` entity names were NOT independently verified.**
Pull them from the live Standardized Subgraphs docs page when writing those two
query modules. Do not guess field names for those families.

Structure query modules **one per schema family, not one per protocol**. Two
different deployment ids tagged with the same `schemaFamily` must run through the
same function with no protocol-specific branch anywhere.

Every query requests provenance alongside the entities:

```graphql
_meta { block { number } hash deployment }
```

This is not decoration. Phase 11 rejects or flags any response whose deployment
does not match the pinned value in `DeploymentRegistryEntry`.

## Substreams (Phases 9–10 — real-time, locked P0)

Confirmed real crates:

```toml
substreams = "0.7"
substreams-ethereum = "0.11"
prost = "0.11"
```

`crate-type = ["cdylib"]`, target `wasm32-unknown-unknown`. Full `Cargo.toml` and
`substreams.yaml` are in `Backend-Suganthan.md` Phase 9 — copy them from there.

Manifest essentials: `specVersion: v0.1.0`, imports the
`substreams-entity-change` spkg, and exposes a `graph_out` map module whose
output type is `proto:substreams.entity.v1.EntityChanges`.

Confirmed real sink packages from pinax-network: **`substreams-sink-webhook`**
(Node/Bun) or **`substreams-sink`** (generic Node CLI).

Scope the Rust module narrowly: emit new funding transfers and new claim/reward
events only. Do not reimplement the risk engine inside the WASM module.

Three things the bridge must do (Phase 10):
1. Verify `SUBSTREAMS_WEBHOOK_SECRET`.
2. **Persist the cursor** so a restart resumes instead of reprocessing.
3. **Handle reorgs** — the sink's "undo" signal must roll back the corresponding
   `EvidenceEvent` rows. Not optional.

Firehose endpoints are third-party-hosted (e.g. Pinax) and **do move** — confirm
the current URL rather than trusting a stale value in `.env`.

## Subgraph MCP (Sylesh Phase 15)

```
https://subgraphs.mcp.thegraph.com/sse
Authorization: Bearer <GRAPH_GATEWAY_API_KEY>
```

Same gateway key as Phase 4. Client is `@mastra/mcp`'s `MCPClient`, which
connects to a `url`-based remote server natively — **no `mcp-remote` proxy
process**. The proxy shown in The Graph's Cursor/Cline docs is for editor
integrations, not backend code.

The agent investigates and explains. It never writes `Claim.riskDecision`.
Cap the tool-call budget with `maxSteps`. Persist its report as a `RiskEvidence`
row with `source: "mcp-investigation"`, never as a free-floating chat message.

## Provenance and freshness (Phase 11)

Before any risk computation consumes evidence, compare the `_meta.block.number`
captured at fetch time against current chain head. If lag exceeds
`FRESHNESS_MAX_BLOCK_LAG`, or a required deployment query failed outright, the
caller gets `PENDING_REVIEW` — never a score.

`/health` reports: Token API last-successful-call timestamp, each enabled
deployment's block lag, and Substreams cursor lag.

## Sanity checks before you commit

- Did every subgraph query ask for `_meta`?
- Is the deployment id a `Qm...` from a table row, not a literal in code?
- Is there a protocol name hardcoded anywhere in `src/`?
- Does a failed or stale fetch produce `PENDING_REVIEW` rather than a score?
- Are block numbers strings/BigInt and amounts strings?
