# Backend-Suganthan — Progress

**Track:** Evidence & Risk Engine, Phases 1–12 of 25
**Spec:** `../../Backend-Suganthan.md`
**Sponsor track:** The Graph (Token API, Standardized Subgraphs, Substreams). No World surface in this track.

Update this file at the end of each phase. Sylesh reads it to know what they can rely on.

---

## Status board

| Phase | Scope                                               | Status                                                                         |
| ----- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1     | Access & credentials (Graph) + local infra          | ✅ **Done** — Token API token + Gateway key + deployment IDs all verified live |
| 2     | Repo scaffold + shared schema + env config          | ✅ **Done**                                                                    |
| 3     | Token API client                                    | ✅ **Done** — verified against the live API                                    |
| 4     | Standardized Subgraphs client + Deployment Registry | ✅ **Done** — verified live across 4 real deployments                          |
| 5     | Evidence Normalizer                                 | ✅ **Done** — idempotency verified against real Postgres                       |
| 6     | Behavior Graph & Clustering                         | ✅ **Done**                                                                    |
| 7     | Risk Engine: feature extractors                     | ✅ **Done**                                                                    |
| 8     | Robust baselines, scoring, policy bands             | ✅ **Done**                                                                    |
| 9     | Substreams Rust module                              | ✅ **Done — verified live on real mainnet blocks**                             |
| 10    | Substreams Node bridge + cache invalidation         | ✅ **Done — verified live, cursor resume proven, reorg tested**                |
| 11    | Provenance & freshness guarantees                   | ⬜ **NEXT**                                                                    |
| 12    | Testing, seed data, Sylesh interface                | 🟡 Partial — interface stubbed early; real bodies land after 8                 |

**10 of 12 done. 191 tests passing. Real-time evidence is live.**

----- | --------------------------------------------------- | ----------------------------------------------- |
| 1 | Access & credentials (Graph) + local infra | 🟡 Partial — infra done, credentials pending |
| 2 | Repo scaffold + shared schema + env config | ✅ **Done** |
| 3 | Token API client | ⬜ Not started — blocked on 1.1 |
| 4 | Standardized Subgraphs client + Deployment Registry | ⬜ Not started — blocked on 1.2 / 1.3 |
| 5 | Evidence Normalizer | ⬜ Not started — _no credentials needed_ |
| 6 | Behavior Graph & Clustering | ⬜ Not started — _no credentials needed_ |
| 7 | Risk Engine: feature extractors | ✅ **Done** |
| 8 | Robust baselines, scoring, policy bands | ✅ **Done** |
| 9 | Substreams Rust module | ✅ **Done — verified live on real mainnet blocks** |
| 10 | Substreams Node bridge + cache invalidation | ✅ **Done — verified live, cursor resume proven, reorg tested** |
| 11 | Provenance & freshness guarantees | ⬜ **NEXT** |
| 12 | Testing, seed data, Sylesh interface | 🟡 Partial — interface stubbed early, see below |

---

## ✅ Phase 2 — Done

Everything below is built, running, and verified on this machine.

### Delivered

| File                                      | What it is                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                            | Node 20+, ESM, scripts for dev/build/test/lint/db/infra                                                                                   |
| `tsconfig.json`                           | TypeScript **strict**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax` |
| `eslint.config.js`                        | ESLint 9 flat config + typescript-eslint                                                                                                  |
| `.prettierrc`                             | Formatting                                                                                                                                |
| `prisma/schema.prisma`                    | **The locked shared schema**, all 11 models                                                                                               |
| `prisma/seed.ts`                          | Skeleton with a section per person                                                                                                        |
| `docker-compose.yml`                      | `postgres:16` + `redis:7`, both healthchecked                                                                                             |
| `.env.example`                            | Both tracks' variables, sectioned                                                                                                         |
| `src/config/env.ts`                       | zod-validated env — the only file that may read `process.env`                                                                             |
| `src/lib/logger.ts`                       | pino                                                                                                                                      |
| `src/lib/prisma.ts`                       | Single `PrismaClient`                                                                                                                     |
| `src/server.ts`                           | Bare Express + `/health` (**Sylesh owns this from Phase 22**)                                                                             |
| `src/interfaces/evidence-risk-api.ts`     | The seam with Sylesh — typed, signatures final                                                                                            |
| `src/interfaces/stub-fixtures.ts`         | Deterministic stub responses; deleted at Phase 12                                                                                         |
| `test/env.test.ts`, `test/health.test.ts` | vitest + supertest                                                                                                                        |

### Verified, not assumed

```
npm run typecheck        clean
npm run lint             clean
npm test                 4/4 passing
docker compose up -d     postgres ready, redis PONG
prisma migrate dev       migration 20260907054526_init_shared_schema applied
psql \dt                 11 models + _prisma_migrations present
npm run db:seed          runs clean
GET /health              -> {"ok":true}
```

That covers the Phase 2 acceptance test in the spec: _"`prisma migrate dev` runs clean against the schema in 0.4; `npm run dev` boots a bare Express server and `/health` returns `{ ok: true }`."_

### Three decisions I had to make (the spec was ambiguous)

1. **Schema path is `backend/prisma/schema.prisma`.** The spec gives three different paths: Section 0.4 says `db/prisma/schema.prisma`, the Section 0.5 tree shows it nested under `src/`, and Phase 12 (plus Sylesh's Phase 23) both say `prisma/seed.ts`. Only the seed path is consistent across both documents, so the schema sits next to it. This also matches Prisma's own convention. **Sylesh: `prisma/schema.prisma` is the real location.**

2. **`generator` and `datasource` blocks were added.** Section 0.4 starts at the first `model`, so it isn't a runnable schema on its own. Everything from `model DeploymentRegistryEntry` down was extracted programmatically from the markdown rather than retyped, so it is byte-identical to the spec.

3. **`.env` loads via Node's native `--env-file`**, not a `dotenv` dependency. Node 20.6+ supports it natively, and it parses the spec's inline `# Phase 1 — …` comments correctly.

### One thing worth knowing

`env.ts` being "the only file that reads `process.env`" is **mechanically enforced**, not a convention. ESLint's `no-restricted-properties` bans `process.env` repo-wide and whitelists exactly one file. This is verified — a scratch file using `process.env` fails lint with a message pointing at Section 0.2.

---

## ✅ Phase 3 — Done

`src/graph/token-api/` — a thin authenticated fetch wrapper. There is no
official Token API SDK, so this is the permanent solution (Section 0.2 rule 2).

`getTransfers`, `getNativeTransfers`, `getBalances`, `getTokens`, plus two
helpers the risk engine needs: `getInboundTransfers` (both feeds merged,
oldest-first — the input to FUNDING_CORRELATION) and `getFirstSeenBlock`
(feeds `Wallet.firstSeenBlock` and WALLET_AGE_SIMILARITY).

**Verified against the live API**, not mocks: real balances returned, 24 merged
inbound transfers for a real mainnet address, `firstSeenBlock` resolved to 25468736. 16/16 unit tests pass with mocked fetch.

### Four spec corrections found by checking the live API

The spec's Section 0.3 endpoint list is wrong in one place. All four were
verified against the service's OpenAPI document (Pinax API 3.21.1) and live
responses:

1. **`/v1/evm/transfers` has no `address` parameter** — it takes `from_address`
   and `to_address`. Passing `address=` returns 200 while ignoring the filter,
   so the spec's shape **fails open**: you get unrelated transfers rather than
   an error. There is a regression test guarding this.
2. **`/v1/evm/transfers/native` is a separate feed and is required.** A funder
   bankrolling a cluster typically sends plain ETH for gas, which never appears
   in the ERC-20 feed. Querying only ERC-20 would leave FUNDING_CORRELATION
   blind to the most common funding pattern.
3. **The free plan caps `limit` at 10 and returns 403 above it** — it does not
   truncate. The client clamps and paginates. Rate limit is 200/min.
4. **`token-api.thegraph.com` fails TLS on this machine** (connection reset,
   while `thegraph.com` resolves fine). Its CNAME target
   `token-api.service.pinax.network` is the same service and works, and is what
   local `.env` points at. `TOKEN_API_BASE_URL` was already config, so this was
   a one-line change rather than a code change.

### Still to do here

`getInboundTransfers` returns raw Token API shapes. Phase 5's normalizer turns
them into `EvidenceEvent` rows; nothing downstream should import from
`src/graph/token-api` directly.

---

## ✅ Phase 4 — Done

`src/graph/standardized-subgraphs/`

- **`deployment-registry.ts`** — the only place "which protocols we support"
  lives. Reads `DeploymentRegistryEntry` at startup with a TTL refresh, so
  adding protocol #10 is an `INSERT` and disabling a misbehaving one is an
  `UPDATE`. No redeploy, no code change. This is the pattern The Graph's Lisbon
  retrospective flagged as the biggest independent convergence across ten teams.
- **`client.ts`** — generic gateway client. Knows how to talk to the gateway and
  how to capture provenance; knows nothing about lending, DEXes or vaults.
- **`queries/{lending-cdp,dex-amm,yield-aggregator}.ts`** — one module per
  **schema family**, never per protocol.

Every query gets `_meta { block { number hash } deployment hasIndexingErrors }`
spliced in automatically, and the result carries a `QueryProvenance` recording
whether the deployment that actually served the data matches the one pinned in
the registry.

### Decisions worth knowing

**The gateway has two URL forms and the spec only shows one.**
`/subgraphs/id/{SUBGRAPH_ID}` and `/deployments/id/{DEPLOYMENT_ID}` are different
identifier spaces. Section 0.3 shows the `subgraphs` form while Section 0.4
documents `deploymentId` as "the `Qm...` id from Graph Explorer" — mixing them
does not resolve. The client picks the path from the identifier's shape.

Pinning to `/deployments/id/` also matters for correctness here:
`/subgraphs/id/` follows whichever version an Indexer has synced, so a decision
replayed months later could disagree with the original. Pinning is what keeps an
Evidence Receipt reproducible.

**Auth is the `Authorization: Bearer` header, not a key in the URL.** The spec's
Section 0.3 shows the legacy key-in-path form. Both resolve on
gateway.thegraph.com, but header auth is what The Graph documents and it keeps
the key out of access logs, proxy logs and `Referer` headers. The legacy form is
still reachable via `GRAPH_GATEWAY_AUTH_MODE=path`.

**402 is not an auth failure.** It means the gateway's escrow is unfunded or its
sender is not whitelisted by Indexers — the credential is fine. `SubgraphQueryError`
separates `isPaymentRequired` from `isAuthFailure` and `isRateLimited` so Phase 11
can report the real cause instead of sending someone to check their API key.

**Unproven provenance counts as a mismatch.** If the gateway reports no
deployment in `_meta`, `deploymentMatches` is `false`, not `true`. Failing
closed is the point.

**A deployment mismatch does not throw.** It is recorded in provenance and left
for Phase 11's freshness guard to act on, which keeps "what happened" separate
from "what do we do about it" and lets an investigator still see the data.

**One failing deployment does not abort the family.** `queryFamily` returns
per-deployment success or error, so a cluster can still be scored on what
succeeded while Phase 11 accounts for what did not.

### The two unverified schema families are now verified

Phase 4 told us to pull `dex-amm` and `yield-aggregator` entity names from live
docs rather than guess. Done — read off the live Messari schema files:

- **dex-amm** (v1.3.2): pool entity is `liquidityPools`, events relate via
  `pool`, and `swaps` exists with no lending equivalent.
- **yield-aggregator** (v1.3.1): pool entity is `vaults`, and there is **no**
  swap or borrow entity at all — only deposits and withdraws.

Concretely: a "generic" shared query would fail on all three families, which is
why they are separate modules.

---

## ✅ Phase 5 — Done

`src/evidence/` — the boundary after which nothing knows which Graph product
produced a fact.

- **`types.ts`** — `NormalizedEvidenceEvent`, plus closed `EventType` /
  `SourceType` unions. `EventType` is closed on purpose: Phase 7's
  PROTOCOL_BEHAVIOR_SIMILARITY compares ordered sequences of these, so a typo
  becoming a new "type" would make two identical behaviours look different.
- **`normalizer.ts`** — pure functions per source. No I/O, no clock, no
  database, so Phases 6-8 can be built and tested against fabricated events
  with no network.
- **`repository.ts`** — the only writer of `EvidenceEvent` rows, so idempotency
  lives in one place rather than being remembered at four call sites. Also
  carries `rollbackEvidenceAboveBlock` for Phase 10's reorg undo and
  `getLatestBlockForChain` for Phase 11's freshness guard.

**Acceptance test passes against real Postgres**, not a mock: feeding the same
Token API response through twice creates one row and reports the second as
skipped. Mocking Prisma here would have tested that the mock returns what the
mock was told to return, and would have passed happily before the constraint
existed.

### Schema change — `EvidenceEvent` now has a unique constraint

```prisma
@@unique([transactionHash, eventType, wallet, sourceId])
```

Phase 5 requires an idempotent upsert, and `EvidenceEvent` had **no unique key
to upsert against**. Section 0.4 in `Backend-Suganthan.md` is updated to match,
and a schema change log now sits in `Backend-Sylesh.md` Section 0.4. This only
touches a model Sylesh's track reads and never writes, so nothing changes on
their side — but they should re-run `prisma migrate deploy`.

**Why `sourceId` is in the key.** The spec suggests
`transactionHash + eventType + wallet` "or similar composite". Those three alone
collide whenever one transaction carries two events of the same type for the
same wallet — a batched deposit into two markets, a multi-hop swap. The second
would silently overwrite the first, and evidence would go quietly missing.
`sourceId` holds the _source's own_ event key (`hash-logIndex` for subgraphs,
`txid-logIndex` for the Token API), which disambiguates without inventing a
`logIndex` column the locked schema does not have.

### Three decisions worth knowing

**`wallet` is the perspective address.** One transfer normalized from both ends
produces two rows — each is evidence about a different wallet — which is why
`wallet` is part of the uniqueness key. Normalizing from an address that is
neither side throws, rather than inventing a relationship the chain never
recorded.

**Protocol and deployment come from the registry, never the response.** A
subgraph response cannot vouch for which pinned deployment produced it.

**Events are immutable observations, so this is an insert, not an update.** If a
row exists for that key, the same on-chain fact was already recorded; rewriting
it would silently mutate the evidence an Evidence Receipt was built from.

---

## ✅ Live end-to-end run (2026-09-07)

Phases 3, 4 and 5 verified together against the real gateway and real Postgres:

```
registry: 4 lending-cdp deployments
   aave-v3      mainnet  QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd
   compound-v2  mainnet  QmZ2LVu8b1J9F92CDRnDKX4CcM21zSNjb9ogdRfMxVCFrg
   compound-v3  mainnet  QmNrQoow7pjM3biRnnhzeCaDYhuEbDyjKCpFeNv2oGXnuK
   compound-v3  polygon  QmSpf6KX1qpKPkMdQWwRee3uyztNbsNn4NQv3Jaf6AC3z7

ONE query function, ALL of them, no protocol branch:
  aave-v3      block 25927250   pinned-match:true   dep:0 bor:0 rep:0 wd:0
  compound-v2  block 25927250   pinned-match:true   dep:5 bor:4 rep:3 wd:5
  compound-v3  block 25927250   pinned-match:true   dep:0 bor:0 rep:0 wd:0
  compound-v3  block 93400300   pinned-match:true   dep:0 bor:0 rep:0 wd:0

normalized -> 17 EvidenceEvents
persist #1: created=17 skipped=0
persist #2: created=0  skipped=17   <- idempotent on real data
```

Two protocols across two chains answered by one function, every response
provenance-checked against its pinned deployment, normalized into one shape, and
written idempotently.

### Picking deployment IDs is not a copy-paste job

**Most subgraphs named "Aave V3 <chain>" are NOT standardized subgraphs.** The
first candidate tried — `QmXZ53Kzz3L2LvvbGve2ebtLKWMhjjB1a3U2jnUj2YwGCW`, Aave
V3 Base, 8.9M queries in 30 days, 100% synced — is live and healthy and
implements **Aave's own schema**: `protocols`, `pools`, `supplies`,
`redeemUnderlyings`, `liquidationCalls`. Of the standardized entities our
lending-cdp module queries, only `borrows` and `repays` exist. The queries
would have failed at runtime.

Every id in `prisma/seed.ts` was therefore **schema-introspected through the
gateway before being added** and confirmed to implement the family it claims.
Do not add a row from an Explorer listing alone.

This is also the deployment registry earning its keep: the fix was five rows in
a seed file, not a line of code.

---

## ✅ Phase 6 — Done

`src/behavior-graph/` — isolated wallets become a graph, then clusters.

- **`pairwise.ts`** — pure. `earliestFunder`, `jaccard`, `scorePair`,
  `buildEdges`.
- **`clustering.ts`** — pure. Union-find with path compression, plus a
  confidence rating for the cluster's _existence_.
- **`index.ts`** — the only file here touching Prisma, so the graph maths stays
  testable with no database.

**Acceptance test passes:** 5 wallets sharing a funder in a tight window form
one cluster (density 1.0, HIGH confidence); 5 unrelated wallets form none, with
zero edges. A mixed run separates them.

### Four decisions

**A pair's score is the MAX of its signals, not the average.** Funding
correlation and counterparty overlap are independent evidence. Wallets funded by
one address minutes apart are related even if they later touch entirely
different protocols — averaging would let an unrelated weak signal dilute a
conclusive one below threshold.

**Two empty counterparty sets score 0, not 1.** Set theory calls the empty
intersection over the empty union undefined. Treating "we know nothing about
either wallet" as perfect similarity would wire every evidence-free wallet into
one giant cluster — the worst available failure for a Sybil firewall.

**Confidence measures whether the cluster is REAL, not how risky it is.** Phase
8 assigns the score. A five-wallet component held together by four
barely-threshold edges is a much weaker claim than five wallets where every pair
is linked, so density is weighed alongside edge strength.

**No singleton clusters.** An unclustered wallet gets `clusterId: null`.
Manufacturing a one-member cluster would make "is this wallet in a cluster"
meaningless.

`persistClusters` writes `score: 0` and leaves scoring to Phase 8 — a
placeholder that looked like a real score is exactly the confident invented
number Section 0.2 rule 4 forbids.

---

## ✅ Phase 7 — Done

`src/risk/features.ts` — the five features, all pure
`(walletSet, evidenceWindow, opts) => { value, confidence, sourceEvidenceIds }`,
exactly as the acceptance test specifies. No database, no network, no clock.

All five separate a coordinated cluster from an unrelated set. 38 tests.

### `value` and `confidence` answer different questions

`value` is how strong the signal is. `confidence` is how much evidence there was
to compute it from. A feature computed from 2 of 20 wallets can produce a
confident-looking number from almost nothing, so confidence is derived from
**coverage**, never from the value. There is a test asserting that 0-with-LOW
("we found nothing and barely looked") is distinguishable from 0-with-HIGH ("we
looked hard and they are genuinely unrelated").

### Four decisions

**Shared funder ≠ co-funded.** One exchange hot wallet funds thousands of
unrelated people over years. `largestWindowCluster` does a two-pointer sweep to
find the largest burst inside `FUNDING_WINDOW_HOURS`, so only wallets funded
together count.

**WALLET_AGE_SIMILARITY stays in block space.** The spec says "converted to
approximate timestamp via average block time" and then normalizes by a block
COUNT, which is dimensionally inconsistent. Staying in blocks also avoids an
average-block-time constant that would be wrong the moment a cluster spans
chains — mainnet is ~12s a block, Polygon ~2s.

**TIMING_CORRELATION uses each wallet's FIRST activity.** The spec says
"timestamps" without saying which. First-activity measures coordinated arrival —
a ring waking up together — rather than being dominated by whichever member
stayed busiest afterwards.

**SHARED_COUNTERPARTY averages over ALL pairs, including empty ones.** Skipping
empty pairs would let a cluster of mostly-unknown wallets inherit the score of
its one well-documented pair.

### A real limitation, surfaced rather than hidden

**Short event sequences inflate PROTOCOL_BEHAVIOR_SIMILARITY.** Drawn from a
seven-value event vocabulary, two wallets with two events each that both open
with a transfer already score 0.5 by coincidence. This surfaced as a failing
test and is a property of the formula, not a bug.

The formula is fixed by the spec, so the correction went into confidence:
sequences shorter than 4 events downgrade it one level and attach the note
"similarity is weakly evidenced". The value stays as specified; the weakness is
visible on the Evidence Receipt instead of silently inflating a score.

---

## ✅ Phase 8 — Done — the engine now decides

`src/risk/{robust,scoring,policy}.ts` plus `docs/RISK-MODEL.md`.

**Live run against real Postgres:**

```
=== COORDINATED RING (5 wallets) ===
  clusters formed : 1 (density 1.00, HIGH)
    FUNDING_CORRELATION            1.000 x 0.25 = 0.250  [HIGH]
    TIMING_CORRELATION             0.976 x 0.15 = 0.146  [HIGH]
    WALLET_AGE_SIMILARITY          1.000 x 0.15 = 0.150  [HIGH]
    SHARED_COUNTERPARTY            1.000 x 0.15 = 0.150  [HIGH]
    PROTOCOL_BEHAVIOR_SIMILARITY   1.000 x 0.15 = 0.150  [HIGH]
  SCORE : 0.8465   DECISION : BLOCK   policyVersion : 1.0

=== CLEAN WALLETS (5 wallets) ===
  clusters formed : 0
  SCORE : 0.0825   DECISION : ALLOW   policyVersion : 1.0
```

Weights, thresholds and PolicyVersion 1.0 are all seeded and active in Postgres.

### The contamination fix is real, and there is a test named after it

If 70% of a campaign is one Sybil ring scoring 0.9 on funding correlation and
the honest 30% score 0.05, a **mean/stddev** baseline puts the attacker less
than one standard deviation from average — unremarkable — and makes the honest
users the outliers. **The detector inverts.** Median/MAD does not.

`THE CONTAMINATION CASE` asserts exactly this, including that a mean-based
z-score would have said the attacker was normal.

### Decisions

**The baseline never changes the score.** It is reported for the receipt so an
investigator can ask "was 0.6 high _for this campaign_?". Folding it in would
make a decision depend on which other claims happened to be in flight.

**`RESERVE` is a real row.** Unallocated 0.15 weight, always contributing 0, so
the table honestly sums to 1.0 and the maximum achievable score is 0.85. "Why
does nothing score 1.0?" is answerable from a row.

**A feature with no weight row throws.** Scoring it silently at 0 would drop a
whole signal without anyone noticing.

**Thresholds must tile [0, 1].** A gap lets a claim fall through with no band;
an overlap makes the band depend on row ordering. Both are rejected.

**Live tables edit, PolicyVersion decides.** Scoring always reads the snapshot,
so an operator halfway through changing weights cannot produce a decision from a
half-changed policy. A version is never overwritten — receipts reference it.

### Stated plainly in RISK-MODEL.md

The weights are **a configurable demo policy, not a validated model**. They were
not fitted against labelled Sybil data and no precision figure exists. The
defensible claim is the stronger one: every number is an inspectable row and
every decision replays exactly.

---

## ✅ Phase 9 — Done, verified on live mainnet data

`backend/substreams/` — a real Rust crate, compiled to `wasm32-unknown-unknown`,
packed into a valid `.spkg`, and run against live Ethereum mainnet through your
own credentials.

```
$ substreams run -e eth.substreams.pinax.network:443 sybil_shield_substreams-v0.1.0.spkg map_funding_transfers -s 21000000 -t +5
Blocks to process in requested range: 5
928 ERC-20 transfers + 316 native transfers, fully decoded, real values
```

`map_funding_transfers` decodes ERC-20 `Transfer` logs (filtered by topic0,
value read as `uint256` → decimal string via `BigInt`, never `u64` — an
18-decimal token overflows 64 bits at ~18.4 tokens) and native-currency
transfers from transaction traces (status `SUCCEEDED` only — a reverted
transaction moves no value and would invent evidence). A watch-list module
parameter keeps the addresses being tracked as config, not a recompile.

### Two real toolchain problems, not typos

1. **`protoc` was not installed** and has no package-manager entry on this
   machine. Fetched the official release zip directly, pointed at it via
   `PROTOC=`.
2. **`substreams-entity-change 2.0.0`** — its only release since 2024 — pins
   `substreams ^0.6`, incompatible with the `substreams ^0.7` this module
   builds against. Two copies of the crate linked into one WASM binary and the
   linker failed with "symbol multiply defined" on the crate's global
   allocator. There is no compatible release to pin against. Checked whether
   it was even needed first: the current `substreams-sink` guide does not
   route a custom app sink through `EntityChanges` at all — Phase 10 consumes
   the typed protobuf directly over gRPC. Dropped `graph_out`/`EntityChanges`
   rather than patching around a dependency that was never required.

**Toolchain note:** the `substreams` CLI ships no native Windows binary.
`ghcr.io/streamingfast/substreams:v1.22.0` (official image) built and ran
everything here.

Installed `streamingfast/substreams-skills` (marketplace + `substreams-dev`
plugin) before starting, per the prize track's own recommendation.

---

## ✅ Phase 10 — Done, verified live: resume-from-cursor and reorg both proven

`src/graph/substreams/{stream,cursor,invalidation-queue,endpoints,run}.ts` —
the bridge from the Phase 9 WASM module to the Phase 5 evidence repository.

Built directly against `@substreams/core` + `@connectrpc/connect-node`
(pinned `0.16.0` / `1.3.0`) rather than a third-party webhook-relay package —
the current `substreams-sink` skill documents exactly this as the current
pattern for a custom app sink, and cursor/reorg handling live in the consumer
either way, so a relay package adds a hop without removing work.

**Every type in `stream.ts` was checked against the installed package**, not
assumed from the skill's illustrative example. Three places the example and
the real `.d.ts` disagreed:

- `createRequest` has no `params` option — module parameters go through
  `applyParams(["module=value"], pkg.modules.modules)` before building the
  request.
- `createGrpcTransport` requires `httpVersion: '2'` — the example omits it.
- `stopBlockNum` is typed `number | bigint | \`+\${number}\`` — a plain numeric
  string is a type error.

### Verified live, three separate real runs

```
RUN 1 (blocks 21000000-002, empty DB): 1536 EvidenceEvents written,
  cursor persisted at 21000002, exit code 0.

RUN 2 (SAME range, cursor already at 002): 1536 rows — UNCHANGED.
  Server-side resumed past the cursored range and reprocessed nothing.
  THIS IS RESUME-FROM-CURSOR, PROVEN, NOT ASSERTED.

REORG TEST (handleUndo against real Postgres): 3 rows across blocks
  100/200/300 -> rollback to 100 -> 1 row remains, cursor rewound
  to the undo signal's cursor.
```

### Three real bugs the tests and live runs caught

1. **`fetchSubstream` cannot read a local file.** It calls the platform
   `fetch`, which does not support `file://` on Node — confirmed by running
   it: `"fetch failed: not implemented... yet..."`. Added `loadPackage()`,
   which reads local paths directly and parses them with `createSubstream`
   (the same function `fetchSubstream` uses internally once bytes exist), and
   only sends an actual `http(s)/ipfs/gs` URL through `fetchSubstream`.
2. **The CLI never exited.** BullMQ's `Queue` holds an `ioredis` connection
   open and Prisma holds its pool open; neither closes itself. A bounded
   (`--stop`) run hung indefinitely after finishing all its work correctly.
   Fixed with an explicit `shutdown()` closing both on completion.
3. **`bullmq` needs `ioredis` as a real dependency**, not bundled — the first
   live run failed at the enqueue step with `BullMQ could not load the
optional 'ioredis' package`. Installed.

### One design change after seeing live logging noise

`persistEvidenceEvent` originally used `create()` + catch-`P2002`. Live
running showed this spams Prisma's global error log on every routine replay —
Prisma logs query errors regardless of whether the caller catches them, and a
replayed event is the EXPECTED case here (Phase 10 resumes at the start of a
block on every reconnect). Switched to `createMany` + `skipDuplicates`, which
never throws for a duplicate. Quieter, and arguably more correct: an expected
outcome should not be modeled as an exception.

### Cursor and reorg discipline

- **Golden Rule 1** — cursor persisted only AFTER evidence is durably written.
  A crash mid-block reprocesses it on restart; Phase 5's idempotent upsert
  makes that free.
- **Golden Rule 4** — one cursor per `(chain, moduleName)`, enforced by a
  unique constraint, tested directly.
- **Reorg** — `handleUndo` rolls back `EvidenceEvent` rows above the last
  valid block, THEN rewrites the cursor, in that order, for the identical
  after-not-before reason as the happy path.
- Cache invalidation is enqueued only when a block actually wrote new rows —
  a replayed block does not wake Sylesh's cache worker for nothing.

### Schema change — `SubstreamsCursor`

```prisma
model SubstreamsCursor {
  id          String   @id @default(cuid())
  chain       String
  moduleName  String
  cursor      String
  blockNumber BigInt
  updatedAt   DateTime @updatedAt
  @@unique([chain, moduleName])
}
```

Required by Phase 10's own acceptance test ("kill and restart the sink
mid-stream, confirm it resumes from the saved cursor") — there was nowhere to
persist one. Section 0.4 updated in `Backend-Suganthan.md`; change logged in
`Backend-Sylesh.md`. Sylesh-track-only, never read or written by their side.

---

## ✅ Phase 1 — Done

| #   | Item                                                      | Status                                            |
| --- | --------------------------------------------------------- | ------------------------------------------------- |
| 1.1 | Graph Market account + Token API JWT                      | ✅ Free tier, verified live                       |
| 1.2 | Gateway API key from Subgraph Studio                      | ✅ Verified live. **Hand to Sylesh for Phase 15** |
| 1.3 | Deployment IDs (`Qm…`)                                    | ✅ 5 seeded, each schema-introspected first       |
| 1.4 | Local Postgres + Redis                                    | ✅ Done                                           |
| 1.5 | Confirm Start Fresh vs. Continuity on the live prize page | ⬜ Still open                                     |

**Still needed from outside the code:** `SUBSTREAMS_ENDPOINT` for Phase 9/10.
The existing Token API JWT already covers Substreams (`substreams_plan_tier:
FREE`), so this is an endpoint URL, not a new credential.

---

## What's left

1. **Phase 7 — feature extractors** (next). The five features at cluster level.
   No credentials, pure functions, testable on synthetic data.
2. **Phase 8 — scoring.** Median/MAD baselines, weights and thresholds from
   tables, `PolicyVersion` snapshotting. **After this the demo works end to
   end:** a coordinated cluster scores CHALLENGE, a clean wallet ALLOW.
3. **Phase 9 — Substreams Rust module.** The long pole. Needs
   `SUBSTREAMS_ENDPOINT`; budget days, not hours, if Rust/WASM is new.
4. **Phase 10 — sink bridge**, cursor resume, reorg undo, and the
   `risk-invalidation` queue Sylesh consumes.
5. **Phase 11 — freshness guard.** Stale or failed evidence yields
   `PENDING_REVIEW`, never a score.
6. **Phase 12 — replace the interface stub** with the real implementation and
   finish the seed scenarios.

Phases 7 and 8 are the highest-value next work: they turn stored evidence into
an actual decision.
