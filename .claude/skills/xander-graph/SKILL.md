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
GET {TOKEN_API_BASE_URL}/v1/evm/balances?network=mainnet&address=0x...
GET {TOKEN_API_BASE_URL}/v1/evm/transfers?network=mainnet&to_address=0x...
GET {TOKEN_API_BASE_URL}/v1/evm/transfers/native?network=mainnet&to_address=0x...
GET {TOKEN_API_BASE_URL}/v1/evm/tokens?network=mainnet&contract=0x...

Headers:
  Accept: application/json
  Authorization: Bearer <GRAPH_MARKET_API_TOKEN>
```

### Corrections verified live in Phase 3 (2026-09-07)

The spec's Section 0.3 endpoint list is wrong in one place and incomplete in
another. These were checked against the service's own OpenAPI document
(Pinax API 3.21.1) and live responses, not recalled:

1. **`/v1/evm/transfers` has no `address` parameter.** It takes `from_address`
   and `to_address` separately. Passing `address=` returns 200 while silently
   ignoring the filter, so this fails open — you get someone else's transfers,
   not an error. Funding evidence uses `to_address`.
2. **`/v1/evm/transfers/native` exists and matters.** Native ETH transfers are a
   separate feed from ERC-20 ones. A funder bankrolling a Sybil cluster usually
   sends plain ETH for gas, which never appears in the ERC-20 feed. Query both.
3. **The free plan caps `limit` at 10 and returns 403 above it** — it does not
   truncate. Clamp and paginate with `page`. Rate limit is 200/min.
4. **Supported `network` values** (OpenAPI enum): `arbitrum-one`, `avalanche`,
   `base`, `bsc`, `hyperevm`, `mainnet`, `optimism`, `polygon`, `unichain`.
5. **Response field names** are snake_case: `block_num`, `datetime`,
   `timestamp`, `transaction_id`, `log_index` (ERC-20) or
   `transaction_index`/`call_index` (native), `contract`, `from`, `to`,
   `amount`, `value`, `network`. Use `amount` (raw string), not `value`
   (lossy pre-divided decimal).
6. **`token-api.thegraph.com` may be unreachable** on some networks — TLS
   handshake reset while `thegraph.com` itself resolves fine. Its CNAME target
   `token-api.service.pinax.network` is the same service and works. This is why
   `TOKEN_API_BASE_URL` is config.

**There is no official Token API Node/TypeScript SDK.** Two independent research
passes confirmed this. Write a thin authenticated `fetch` wrapper — that is the
permanent answer, not a stopgap waiting for an SDK that does not exist. Do not
import a package that claims to be one.

`network` is one of The Graph's supported network IDs. Load the supported list
from config; never a hardcoded `switch`.

## Getting the Gateway API key

**Subgraph Studio → "API Keys" tab → "Create API Key"**, at
<https://thegraph.com/studio/>. Free.

This is **not** the subgraph deploy key. A deploy key (`graph auth <key>`)
only publishes your own subgraph and cannot query the gateway; the two live on
different Studio pages and are easy to confuse. This project never authors or
deploys a subgraph — it queries existing ones — so the deploy key is never used.

The same key powers Subgraph MCP (Sylesh Phase 15).

## Standardized Subgraphs (Phase 4 — cross-protocol DeFi)

GraphQL over `POST`. **Two consumer-facing request shapes:**

```
POST /api/subgraphs/id/{SUBGRAPH_ID}      # gateway picks the latest synced deployment
POST /api/deployments/id/{DEPLOYMENT_ID}  # pins an exact version
```

**Auth is a header**, not a path segment:

```
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

The legacy `/api/{key}/subgraphs/id/...` form (key in the URL) still resolves on
gateway.thegraph.com and is available behind `GRAPH_GATEWAY_AUTH_MODE=path`, but
header auth is the documented method and keeps the key out of access logs, proxy
logs and `Referer` headers. Default to header.

**The path segment must match the identifier kind.** A deployment id (`Qm…` IPFS
CIDv0, or a 0x-prefixed hash) goes under `/deployments/id/`; a base58 subgraph id
goes under `/subgraphs/id/`. The spec shows only the `subgraphs` form while
documenting `deploymentId` as "the `Qm...` id from Graph Explorer" — different
identifier spaces; mixing them fails to resolve. `client.ts` picks from shape.

**Prefer `/deployments/id/` for this project.** `/subgraphs/id/` silently
follows whichever version an Indexer has synced, so a decision replayed later
could disagree with the original. Pinning is what makes an Evidence Receipt
reproducible.

### Gateway status codes worth distinguishing

| Code      | Meaning                                                                |
| --------- | ---------------------------------------------------------------------- |
| 401 / 403 | Key missing, disabled, or outside its subgraph/domain allow-list       |
| 429       | Key's rate limit or monthly cap reached                                |
| **402**   | **Gateway escrow unfunded, or its sender not whitelisted by Indexers** |

402 is _not_ an auth failure — the credential is fine, the payment path is not.
Conflating them sends an operator hunting a key problem that does not exist.

### API key restrictions (set in Studio)

A key can carry a subgraph allow-list, a domain (Origin/Referer) allow-list, and
a rate limit, and can be disabled without deletion. All are enforced before the
query runs — so a 403 may mean "key is fine but this subgraph isn't on its
allow-list."

### x402 — pay-per-query without an API key

Autonomous agents can skip API keys entirely: `POST /api/x402/subgraphs/id/{id}`
settles a per-query payment in USDC on Base via the x402 protocol. Not used by
this project (we hold a key), but worth knowing it exists — an agent-run Sybil
firewall paying per query is a coherent future shape, and the `402` code above
is the same protocol surfacing.

Never use the display name. A wrong or stale deployment id silently returns
nothing useful.

The Graph publishes **11 standardized schemas**: Generic 3.0.0, DEX AMM 1.3.2,
DEX AMM Extended 4.0.1, DEX Aggregator 1.0.2, Lending/CDP 3.1.0, Yield
Aggregator 1.3.1, NFT Marketplace 2.1.0, Network 1.2.0, Bridge 1.2.0,
Derivatives Perps 1.3.4, Derivatives Options 1.3.2.

### Confirmed entity names

**`lending-cdp`** (Messari Lending/CDP v3.1.0 — Aave, Compound, MakerDAO, Spark,
Venus and dozens more across Ethereum, Polygon, Arbitrum, Avalanche, BSC,
Optimism, Base):

```
lendingProtocols, markets, accounts, positions,
deposits, borrows, repays, withdraws, liquidates, flashloans,
financialsDailySnapshots, marketDailySnapshots, usageMetricsDailySnapshots
```

**`dex-amm`** (Messari DEX AMM v1.3.2) — verified 2026-09-07 against the live
`schema-dex-amm.graphql`, which the spec had flagged as unverified. Top-level
entities: `Token, RewardToken, LiquidityPoolFee, DexAmmProtocol,
UsageMetricsDailySnapshot, UsageMetricsHourlySnapshot, FinancialsDailySnapshot,
LiquidityPool, LiquidityPoolDailySnapshot, LiquidityPoolHourlySnapshot,
Deposit, Withdraw, Swap, Account, ActiveAccount`.

**`yield-aggregator`** (Messari Yield Aggregator v1.3.1) — also verified
2026-09-07. Top-level entities: `Token, RewardToken, VaultFee, YieldAggregator,
UsageMetricsDailySnapshot, UsageMetricsHourlySnapshot, FinancialsDailySnapshot,
Vault, VaultDailySnapshot, VaultHourlySnapshot, Deposit, Withdraw, Account,
ActiveAccount`.

**The families are not interchangeable.** The pool-equivalent entity is
`markets` in lending, `liquidityPools` in dex-amm, `vaults` in yield-aggregator;
events relate via `market` / `pool` / `vault` respectively. Only dex-amm has
`swaps`; only lending has `borrows`/`repays`/`liquidates`; yield-aggregator has
deposits and withdraws only. This is precisely why the code is organised one
module per family — a shared "generic" query would break on all three.

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

**Built and verified live on real mainnet blocks, 2026-09-08.** Everything
below is confirmed from the actual build and a real streaming run, not the
spec's scaffold alone.

### Toolchain

The `substreams` CLI ships **no native Windows binary** (v1.22.0 releases:
darwin_arm64, darwin_x86_64, linux_arm64, linux_x86_64 — nothing else). Use
the official Docker image:

```
docker run --rm ghcr.io/streamingfast/substreams:v1.22.0 --version
```

`protoc` has no package-manager entry on a bare Windows box either — fetch the
release zip from `protocolbuffers/protobuf` directly and point `prost-build`
at it via `PROTOC=<path>`.

`rustup target add wasm32-unknown-unknown` is required before the first build.

### Crate versions — confirmed on crates.io 2026-09-08

```toml
substreams = "0.7"            # 0.7.6 latest — matches the spec
substreams-ethereum = "0.11"  # 0.11.1 latest — matches the spec
prost = "0.13"                 # NOT 0.14 — see below
prost-types = "0.13"
prost-build = "0.13"           # build-dependency
```

**`prost` must be pinned to `0.13`, not `0.14`.** `substreams 0.7.6` is built
against `prost 0.13`'s `Message` trait. Pinning `prost = "0.14"` compiles
clean in isolation but fails at the `#[substreams::handlers::map]` call site
with "the trait bound `T: prost::message::Message` is not satisfied" — two
different major lines of the same crate define incompatible `Message` traits,
and generated proto types from 0.14 do not satisfy 0.13's bound.

**Do not add `substreams-entity-change`.** Its only release since 2024
(`2.0.0`) pins `substreams ^0.6`, semver-incompatible with `substreams ^0.7`.
Two copies of the `substreams` crate link into one WASM binary and fail with
"symbol multiply defined" on the crate's global allocator export — an LTO
linker error, not a version-resolution error, so `cargo tree` is what surfaces
the real cause (`cargo tree -i substreams@0.6.4`). There is no compatible
release. It is also not needed: a custom app sink (this project's shape)
consumes the typed module output directly over gRPC — `graph_out`/
`EntityChanges` exists for a Substreams-powered _subgraph_, which this
architecture does not build.

`crate-type = ["cdylib"]`, target `wasm32-unknown-unknown`. Real
`Cargo.toml`/`substreams.yaml` live in `backend/substreams/` — a working,
tested reference, not just a scaffold.

### Building and running

```bash
# Pack — always via the Docker image on Windows
docker run --rm -v "$(pwd)/substreams:/work" -w /work \
  ghcr.io/streamingfast/substreams:v1.22.0 pack ./substreams.yaml \
  -o ./sybil_shield_substreams-v0.1.0.spkg

# Run — CLI flags that differ from casual assumption:
#   -e/--endpoint is a FLAG, not positional
#   -s/-t take a string; -t accepts a bare number OR +N relative to -s
docker run --rm -e SUBSTREAMS_API_TOKEN="$TOKEN" \
  ghcr.io/streamingfast/substreams:v1.22.0 \
  run -e basesepolia.substreams.pinax.network:443 <spkg> <module> -s 46530000 -t +5 -o jsonl
```

### JavaScript consumer SDK — confirmed against the installed package, not the docs example

```bash
npm install @substreams/core@0.16.0 @connectrpc/connect@1.3.0 @connectrpc/connect-node@1.3.0
```

Versions confirmed live on npm (`@substreams/core@0.16.0` peers
`@connectrpc/connect@^1.3.0`) — these are current, not stale pins.

**Three places the skill's illustrative example diverges from the real
`.d.ts` files** (found by typechecking against the installed package):

1. **`createRequest` has no `params` field.** Module parameters are NOT set on
   the request. They are applied to the package's modules first:
   ```ts
   applyParams([`${moduleName}=${value}`], pkg.modules?.modules ?? []);
   // THEN createRequest({ substreamPackage: pkg, ... })
   ```
2. **`createGrpcTransport` requires `httpVersion: '2'`.** `NodeTransportOptions`
   is a discriminated union on that field with no default.
3. **`stopBlockNum` is `number | bigint | \`+\${number}\``— not`string`.** A
plain numeric string like `"1000"`is a type error; only the`+N` relative
   template-literal form is a string.

**`fetchSubstream` cannot read a local file.** It calls the platform `fetch`
internally, which does not implement `file://` on Node (`fetch failed: not
implemented... yet...`, confirmed by running it). For a local `.spkg`, read the
bytes with `fs.readFile` and parse with `createSubstream(bytes)` — the same
function `fetchSubstream` calls once it has bytes in hand. Reserve
`fetchSubstream` for an actual `http(s)/ipfs/gs` URL.

**Unpack the map output with `unpackMapOutput(response, registry)`**, not
manual `.output?.mapOutput` + `.toJson()` on the `Any` — the dedicated export
exists precisely for this and handles the `Any` → typed message step.

**A bounded run needs an explicit shutdown.** BullMQ's `Queue` (ioredis) and
Prisma both hold long-lived connections that keep the Node process alive;
neither closes on its own. A CLI using `--stop` finishes all its work
correctly and then hangs forever without an explicit `queue.close()` +
`prisma.$disconnect()` in a `finally`. Confirmed by running it.

**`BlockRef.number` is a `bigint`, not `.num`.** The skill's own doc flags
this: `lastValidBlock.num` in some example code is a real upstream bug that
silently prints `undefined`. The field is `number`.

Scope the Rust module narrowly: emit new funding transfers only. Do not
reimplement the risk engine inside the WASM module.

Three things the bridge must do (Phase 10) — all built, all verified live:

1. **Persist the cursor** so a restart resumes instead of reprocessing.
   Verified: re-running an identical block range against an already-persisted
   cursor produced zero new rows — the server resumed past it.
2. **Handle reorgs** — the sink's "undo" signal must roll back the
   corresponding `EvidenceEvent` rows, then rewind the cursor. Verified against
   real Postgres with a synthetic undo signal.
3. **Enqueue cache invalidation** only when new rows were actually written —
   a replayed block should not wake Sylesh's cache worker for nothing.

### The build/demo target is Base Sepolia, not mainnet

2s blocks, cheap to stream and iterate against, and `base` is already a
`TOKEN_API_NETWORKS` entry (Phase 3) so this chain's evidence needs no new
network invented anywhere else in the pipeline. Flip to a mainnet chain at
ship time by changing `network:` in `substreams.yaml` plus one
`SUBSTREAMS_ENDPOINTS` entry — everything else (the watch-list, the
normalizer, the risk engine) is already chain-agnostic.

**The Base Sepolia endpoint is not in the published endpoint table.**
`docs.substreams.dev/reference-material/chain-support/chains-and-endpoints`
lists Base _mainnet_ for both StreamingFast and Pinax but no Base Sepolia row
for either, as of 2026-09-08. Found by pattern-matching Pinax's own
documented `basesepolia.rpc.pinax.network` RPC endpoint naming — **no dash**
(`basesepolia`, not `base-sepolia`) — confirming TLS reachability directly,
then proving it with a real `substreams run`. If this endpoint stops
resolving, re-verify it exactly this way rather than assuming a renamed
successor.

```
Verified endpoint: basesepolia.substreams.pinax.network:443
Manifest network:  base-sepolia
Head block ~2026-09-08: 46,539,941 (2s blocks — moves fast, re-check before reuse)
```

### Verified live run

```
5 blocks from Base Sepolia block 46530000 (substreams run, Phase 9 acceptance test):
  113 ERC-20 transfers + native transfers, fully decoded. "Completed successfully".

3 blocks through the full Phase 10 Node consumer, empty DB:
  155 EvidenceEvents written, cursor persisted at block 46530002.

SAME 3-block range re-run with the cursor already there:
  155 rows — unchanged, zero errors. The server resumed past the cursored
  range. This is resume-from-cursor PROVEN against a live endpoint, not
  asserted by a mock.
```

### Endpoints — verified reachable 2026-09-08

gRPC `host:port`. **No `https://` prefix** — that is the most common mistake and
the resulting failure is opaque.

| Chain            | Pinax                                                                                                                   | StreamingFast                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Ethereum mainnet | `eth.substreams.pinax.network:443`                                                                                      | `mainnet.eth.streamingfast.io:443`      |
| Ethereum Sepolia | `sepolia.substreams.pinax.network:443`                                                                                  | `sepolia.eth.streamingfast.io:443`      |
| Base             | `base.substreams.pinax.network:443`                                                                                     | `base-mainnet.streamingfast.io:443`     |
| **Base Sepolia** | **`basesepolia.substreams.pinax.network:443`** (no dash — undocumented, found by RPC-name pattern match, verified live) | not found for StreamingFast             |
| Polygon          | `polygon.substreams.pinax.network:443`                                                                                  | `polygon.streamingfast.io:443`          |
| Arbitrum One     | `arbone.substreams.pinax.network:443`                                                                                   | `arb-one.streamingfast.io:443`          |
| BSC              | `bsc.substreams.pinax.network:443`                                                                                      | `bnb.streamingfast.io:443`              |
| Optimism         | —                                                                                                                       | `mainnet.optimism.streamingfast.io:443` |

**Holesky is sunset** — `holesky.substreams.pinax.network` no longer resolves.
Do not re-add it.

**The Token API JWT already authenticates Substreams.** It carries
`substreams_plan_tier: FREE` with `SUBSTREAMS_MAX_REQUESTS: 2` and
`SUBSTREAMS_PARALLEL_JOBS: 5`, and its issuer is `dfuse.io` — the same
Pinax-operated identity behind thegraph.market. No second credential is needed.
The CLI reads `SUBSTREAMS_API_TOKEN`, or takes `--substreams-api-token`.

Keys, if a new one is ever needed: <https://thegraph.market/>,
<https://app.pinax.network/>, <https://app.streamingfast.io/>.

Endpoints are configured in `SUBSTREAMS_ENDPOINTS` as `network=host:port` pairs
and resolved by `src/graph/substreams/endpoints.ts`. They are third-party-hosted
and **do move** — never bake a hostname into source.

## Subgraph MCP (Sylesh Phase 15)

```
https://subgraphs.mcp.thegraph.com/sse
Authorization: Bearer <GRAPH_GATEWAY_API_KEY>
```

Same gateway key as Phase 4. Covers 15,000+ subgraphs. Tools it exposes: get
schema by deployment id / subgraph id / IPFS hash; execute query by deployment
id or subgraph id; search subgraphs by keyword; get 30-day query counts for a
deployment; get top subgraph deployments for a contract address. Client is `@mastra/mcp`'s `MCPClient`, which
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

## Agent0 subgraphs (ERC-8004) — available, not currently used

Agent0 indexes the ERC-8004 Trustless Agents registries (Identity, Reputation,
Validation) across Ethereum, Base, BSC, Polygon and Monad plus their testnets,
queried through the same gateway URL and API key. Not part of the 25 phases;
noted because agent reputation data is adjacent to Sybil scoring and may be
worth citing in the submission.

## Official skill packs (optional, not installed)

The Graph and StreamingFast publish their own Claude skills:

```bash
claude plugin marketplace add streamingfast/substreams-skills
claude plugin install substreams-dev@streamingfast-substreams
```

Nine substreams skills (dev, ethereum, solana, sql, sink, sink-deploy-local,
hosted-sink, thegraph-market-api, testing). Worth installing before Phase 9,
which is the Rust/WASM long pole.

There is also a subgraph-authoring skill pack (`subgraph-dev`,
`subgraph-optimization`, `subgraph-testing`). **It is not relevant here** — it
covers writing and deploying your own subgraph, which this architecture
deliberately does not do.
