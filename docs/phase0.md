# Phase 0 — Stabilize V1

**Status:** Complete
**Date:** 2026-09-12
**Spec:** `Xander/xander-v2-backend.md` §33 Phase 0
**Goal:** Freeze the proven V1 system before any V2 layer is added.

---

## 1. What Phase 0 required

The V2 spec lists five work items and seven "done when" conditions.

| Spec work item | Status |
|---|---|
| Complete the remaining V1 joint Phase 25 run | Done — §5 below |
| Refresh the seed-fixture timestamp problem | Done — §4 |
| Implement known-funder registry | Done — §3 |
| Update stale README / build-status claims | Done — §6 |
| Create V2 feature branch | **Deliberately not done** — the user directed all work to stay on `main`. Noted so the deviation is explicit rather than silent. |

| "Done when" | Result |
|---|---|
| clean claim works | `ALLOW`, score 0 |
| challenge works | `CHALLENGE`, score 0.43, `SELFIE_CHECK` required, IDKit payload issued |
| World proof works | Real ECDSA RP signature + real World API rejection handled correctly (see §5.4 for the one part not repeatable here) |
| blocked cluster works | `BLOCK`, score 0.8465 |
| Substreams invalidation works | 1,521 real Base Sepolia events, cursor resume proven, invalidation jobs consumed |
| MCP investigation works | Real grounded investigation, 2 real tool calls |
| existing test suite green | 330 passed / 5 skipped / 0 failed, stable across 3 consecutive runs |

---

## 2. Environment fix (prerequisite, not in the spec)

The repo would not run on this machine at all before anything else could start.

- **Port clash.** `docker-compose.yml` bound host ports 5432/6379, both already held by unrelated projects (`peregrine-postgres`, `sellergeni-redis`). Xander now uses **5433** (Postgres) and **6380** (Redis).
- **Four files must stay in sync**, and the fourth is easy to miss: `docker-compose.yml`, `.env`, `.env.example`, and **`vitest.config.ts`**, which hardcodes its own `DATABASE_URL`/`REDIS_URL` independent of `.env`. A mismatch surfaces as a Prisma *authentication* error in the DB tests, which reads like a credentials problem rather than a port problem.
- `node_modules` was absent; dependencies installed, migrations applied, database seeded.

---

## 3. Known-funder registry — the main deliverable

This closes the promise `Readme.md` has carried since day one and called *"the single most important lesson"* from the Arbitrum airdrop precedent, and which had **no implementation behind it**. Until now `FUNDING_CORRELATION` treated a shared funder identically whether it was a private wallet or a Binance hot wallet.

### 3.1 Schema

New model `KnownFunderAddress` (migration `add_known_funder_address`), unique on `(chain, address)`, which also serves as the index V2 §26 requires. Purely additive — no existing model changed.

Two deliberate deviations from the spec's field list, both documented in the schema itself:

- **`chain` (slug) not `chainId` (numeric).** It has to join against `EvidenceEvent.chain`, which is a slug. Carrying a numeric id would force a slug→id mapping table before a single lookup could resolve. V2's own actor/wallet tables can carry numeric `chainId` from Phase 1 onward.
- **`source` and `confidence` are load-bearing, not decoration.** A funder label is an assertion made by somebody, and a wrong label is a security hole in *both* directions — it can excuse a real attacker's funder, or fail to excuse a real exchange. The row records who said so, so a bad label is auditable rather than anonymous.

`validFrom` / `validTo` exist because labels expire: an exchange rotates a hot wallet and the old address stops being operational. Lookups filter on the window rather than deleting rows, so a decision made last month stays reconstructable against the labels that were live when it was made.

### 3.2 The scoring change — and why it is not a bypass

The naive fix is "discount the score if the shared funder is labelled". That is exploitable: a ring funds itself privately, routes one extra transfer through Binance, and launders the whole cluster.

Instead, labelled and unlabelled funders are scored **separately** and the higher wins:

```
value = max(unlabelledValue, labelledValue × KNOWN_FUNDER_WEIGHT_MULTIPLIER)
```

- Arbitrum-style false positive (everyone withdrew from one exchange) → collapses from **1.0 to 0.15**.
- Ring with a private shared funder plus an exchange decoy → still scores the private funder at **full weight**, undiscounted.

It down-weights rather than excludes **on purpose**: a coordinated ring genuinely can be run out of one exchange account, so the signal is weakened, never erased. Multiplier is config (`KNOWN_FUNDER_WEIGHT_MULTIPLIER`, default 0.15), never inline.

Confidence is untouched by labelling — coverage ("how much evidence was there") and labelling ("who was the funder") answer different questions and must not be conflated.

### 3.3 Seed data — every address verified, none typed from memory

A single mistyped nibble in an exclusion list is a silent security hole, so the seed file is **generated from verified sources**, not transcribed.

| Category | Rows | Source | Confidence |
|---|---|---|---|
| BRIDGE | 10 | Official Base contract docs + Optimism superchain-registry | HIGH |
| EXCHANGE | 100 | Intersection of two independent public label datasets | MEDIUM |
| FAUCET | **0** | — | — |

- **Bridges** are first-party publications by the teams that deployed the contracts: 7 on Ethereum Sepolia (Base Sepolia + OP Sepolia L1 contracts) and 3 on mainnet.
- **Exchanges** are only addresses appearing in **both** datasets with agreeing names — 100 of 373 candidates survived. Two rename aliases reconciled by hand (OKEx→OKX, MXC→MEXC). MEDIUM not HIGH: nobody at Binance publishes a signed list of its hot wallets, so these are third-party observation, however well corroborated.
- **FAUCET is deliberately empty.** This project runs on testnets, where a public faucet is the single most common shared funder and would be the most valuable row this table could hold. But no faucet operator publishes its dispenser EOA, and searching testnet explorers returns faucet *tokens*, not funding addresses. Inventing one would be exactly the category of fake this codebase refuses. The category is live in the enum and a row can be inserted the moment a real dispenser is observed in our own evidence.

### 3.4 Layering

`fundingCorrelation` stays a **pure function** — it reads a `ReadonlyMap` it was handed. The impure DB read happens once in `src/risk/index.ts`, cached in-process for `KNOWN_FUNDER_CACHE_TTL_SECONDS`, mirroring the deployment registry.

---

## 4. Fixture freshness fix

**The bug.** Fixture rows are deduplicated forever by `@@unique([transactionHash, eventType, wallet, sourceId])` — the transaction hashes are deterministic (`0xseedring0a`), so re-seeding is a genuine no-op and the original `createdAt` survives. The Phase 11 freshness guard judges `token-api` evidence purely on `createdAt` recency against a 6-hour window. **Six hours after the first seed, every fixture wallet resolves `PENDING_REVIEW` from wall-clock time alone**, with no code defect. This cost two hand-written `UPDATE` statements during the V1 audit session alone.

**The fix.** `refreshFixtureFreshness()` re-stamps `createdAt`, called at the end of every seed, plus a new `npm run db:seed:refresh` fast path.

**Only `createdAt` moves.** `timestamp` is the observation's on-chain time, and every scenario is encoded in the *relative spacing* of those values — a tight funding burst, a month-long gap for the clean wallet, a 20-hour co-funding window. Rewriting them to `now()` would collapse every scenario into a single instant and silently invert what the fixtures test. The freshness guard never reads `timestamp`, so moving `createdAt` alone is both sufficient and safe. Scoped to `chain = 'seed'`, which no real source emits.

---

## 5. Phase 25 joint run — live verification

Run against real credentials and real networks, not in-process mocks.

### 5.1 The Graph

- **Token API** — live: 3 balances, 10 transfers for a real address.
- **Standardized Subgraphs** — live: `aave-v3` @ block 25957368, `pinned-match=true`.
- **Substreams** — the real Rust/WASM module was **built from source** (`cargo build --target wasm32-unknown-unknown --release`), packed to a `.spkg`, and streamed live against Base Sepolia. **1,521 real evidence events**, blocks 46530000–46530027.
- **Cursor resume proven**: second run given *no* `--start` resumed from the stored cursor at 46530019 and advanced to 46530027. No restart from zero, no duplicate rows.
- **Invalidation** — the stream enqueued real BullMQ jobs; the running worker consumed them and evicted/recomputed cache entries.

### 5.2 Subgraph MCP — a finding that changes the V1 audit

The V1 audit recorded the hosted endpoint `https://subgraphs.mcp.thegraph.com/sse` as **broken server-side** (HTTP 200, then zero bytes), requiring a locally built `subgraph-mcp` binary over stdio as a workaround.

**That endpoint has recovered.** It now completes a proper MCP handshake and returns real data:

- 9 tools discovered over SSE
- `search_subgraphs_by_keyword("uniswap")` → **7,177 bytes of real data**

Also fixed: `SUBGRAPH_MCP_COMMAND` in `.env` pointed at `D:/Projects/...exe`, a **Windows path from another machine** that could never resolve on macOS. Cleared, so the client uses the working hosted endpoint. **The local-stdio workaround is no longer needed.**

### 5.3 Investigation agent

Real end-to-end run: status `COMPLETE` in 6.2s, 2 real tool calls with citations, evidence anchored to a real `RiskEvidence` row, and the safeguard verified — **the agent did not touch any claim decision**.

### 5.4 Decision paths over live HTTP

| Scenario | Decision | Detail |
|---|---|---|
| Clean fixture wallet | `ALLOW` | score 0 |
| Challenge-band cluster | `CHALLENGE` | score 0.43, `SELFIE_CHECK`, IDKit payload issued |
| Coordinated 5-wallet ring | `BLOCK` | score 0.8465 |
| Genuinely unknown wallet | `PENDING_REVIEW` | *"an unknown wallet is not a safe wallet"* |

**World:**
- `POST /world/rp-signature` → real secp256k1 signature with nonce and expiry, server-side only.
- `POST /world/verify` with a deliberately invalid proof → **real call to World's live API**, which returned a genuine 400, and the backend surfaced World's own detail (`"action is required for uniqueness proofs"`) rather than flattening it to a bare status code.

**Not repeatable here:** the real-phone biometric Selfie Check. That was completed on 2026-09-09 with a real device and a real V3 proof; it needs physical hardware and cannot be re-run from this session. Stated plainly rather than implied.

---

## 6. Two real test defects found and fixed

Both were exposed *by* the live run — neither was visible from the test suite alone.

### 6.1 The "unknown wallet" test asserted nothing

`test/claim-api.db.test.ts` screened the hardcoded constant `0x00000000000000000000000000000000deadbeef` and expected `PENDING_REVIEW`. But that is a **real mainnet address with real history**. The moment the joint run screened it against a live Token API, **82 genuine evidence rows** landed in the shared dev database, the wallet stopped being unknown, and the test flipped to `ALLOW` permanently.

It only ever passed because the test environment uses a *fake* Token API token, so the fetch returned nothing. A test for "unknown wallet" has to supply a wallet that *cannot* have been seen. Now generates a fresh random address per run.

### 6.2 My own new test was flaky by construction

The first version of `test/seed-refresh.db.test.ts` aged **all** fixture rows to 2020 to prove the refresh worked. Vitest runs test *files* in parallel, and those fixtures are shared global state — so while it ran, `FIXTURE_CLEAN_WALLET` correctly resolved `PENDING_REVIEW`, which is deliberately never cached, which failed the invalidation-worker test running alongside it.

Rewritten to create its own dedicated stale row and never touch the shared fixtures. Confirmed stable across three consecutive full-suite runs.

---

## 7. README corrections

- **Test count** — "212/212" replaced with the measured 330 passed / 5 skipped / 0 failed.
- **Phase status** — Phases 13–24 corrected from *"specified, in progress"* to done and live-verified; Phase 25 named as the single open V1 phase.
- **Known-funder claim** — rewritten from an aspirational "exclusion list" to what actually exists: the separate-scoring mechanism, the real row counts, and an explicit note that FAUCET is empty and why.
- **Local setup** — documents the 5433/6380 remap, the four files that must stay in sync, and `db:seed:refresh` as the fix for an unexpected `PENDING_REVIEW`.

---

## 8. Schema-change etiquette

The locked-schema rule requires a model change to be logged in Section 0.4 of **both** spec markdown files in the same sitting. Done:

- `Backend-Suganthan.md` — full model definition with rationale.
- `Backend-Sylesh.md` — schema change-log entry, including the one behavioural consequence for that track: a cluster co-funded by a *labelled* exchange or bridge now scores materially lower on that feature, so some claims that previously landed in `CHALLENGE` will land in `ALLOW`.

---

## 9. Files changed

**New**
```
backend/prisma/seed-data/known-funders.ts          110 verified rows, generated
backend/src/risk/known-funders.ts                  registry loader + TTL cache
backend/test/known-funders.db.test.ts              6 tests, real Postgres
backend/test/seed-refresh.db.test.ts               2 tests, runs the real command
backend/prisma/migrations/…_add_known_funder_address/
```

**Modified**
```
backend/prisma/schema.prisma        KnownFunderAddress model
backend/prisma/seed.ts              seedKnownFunders + refreshFixtureFreshness
backend/src/risk/features.ts        split labelled/unlabelled funder scoring
backend/src/risk/types.ts           chain on RiskEvidenceRow, known-funder types
backend/src/risk/index.ts           async featureOptions() loads the registry
backend/src/config/env.ts           2 new knobs
backend/package.json                db:seed:refresh
backend/docker-compose.yml          5433 / 6380
backend/.env.example                ports + guidance
backend/vitest.config.ts            ports
backend/test/features.test.ts       6 new known-funder tests
backend/test/claim-api.db.test.ts   unknown-wallet test fixed
Backend-Suganthan.md                Section 0.4 model
Backend-Sylesh.md                   Section 0.4 change log
Readme.md                           truth-up
```

---

## 10. Test results

```
typecheck   clean
lint        clean
tests       330 passed | 5 skipped | 0 failed   (335 total, 27 files)
            stable across 3 consecutive runs
```

Up from the 316-passing baseline: **+14 tests**, all real, no mocks added. The suite still contains zero `vi.mock()` module mocks.

---

## 11. Carried into Phase 1

1. **No V2 branch** — all work on `main` by direction.
2. **FAUCET rows still needed.** The highest-value category for a testnet deployment is empty because no dispenser EOA is published. Worth revisiting by observing high-out-degree funders in our own streamed evidence.
3. **The V1 risk model remains a demo policy, not a validated model** — max score 0.85 with an honest `RESERVE` row. V2 must not relabel it.
4. **`chain` vs `chainId`** — Phase 1's actor/wallet tables should carry numeric `chainId`; a mapping to the slug convention will be needed where the two meet.
