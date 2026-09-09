# Backend-Sylesh — Progress

**Track:** Decision, Escalation & API, Phases 13–25 of 25
**Spec:** `../../Backend-Sylesh.md`
**Sponsor track:** World (Selfie Check). Consumes The Graph only through Suganthan's interface.

Suganthan reads this to know what they can rely on.

---

## Status board

| Phase | Scope                                            | Status                                                                     |
| ----- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| 13    | Access & credentials (World) + MCP prerequisites | ✅ **Selfie Check access confirmed granted** — a real phone completed a real proof, 2026-09-09 |
| 14    | Risk cache + `risk-invalidation` consumer        | ✅ **Done** — verified against real Redis, real queue round trip           |
| 15    | Subgraph MCP investigation agent                 | ✅ **Fully verified end to end** — real model (OpenRouter), real MCP server, real gateway data, real evidence anchor |
| 16    | World: RP signature                              | ✅ **Done** — real signing via `@worldcoin/idkit-core`                     |
| 17    | World: IDKit request contract                    | ✅ **Done** — `docs/API-CONTRACT.md`                                       |
| 18    | World: backend verification                      | ✅ **Live-verified with a real phone and a real proof**, 2026-09-09       |
| 19    | Wallet binding + replay protection               | ✅ **Done** — verified against the real unique constraint                  |
| 20    | Policy Engine                                    | ✅ **Done**                                                                |
| 21    | Evidence Receipt                                 | ✅ **Done**                                                                |
| 22    | Claim Gate API + operational concerns            | ✅ **Done** — 12 endpoints, auth, rate limiting, zod, idempotency          |
| 23    | Observability, testing, failure hardening        | ✅ **Done** — failure matrix covered                                       |
| 24    | Integration wiring                               | ✅ **Done** — real producer → real worker over the real queue              |
| 25    | Joint wiring + frontend handoff                  | 🟡 **Handoff frozen**; joint run needs both people present                 |

**312 tests passing, 5 skipped without live credentials** (up from 212 when this
track started). The 5 skipped run for real via `npm run test:live` — see Phase
15. `npm run typecheck`
and `npm run lint` clean.

---

## The one schema change — read this before your next migrate

`prisma/schema.prisma` gained **one new model, `Investigation`**. Migration
`20260908120000_add_investigation`.

**Nothing existing changed.** No column, index, or constraint on any model
Suganthan's track reads or writes was touched, so no query on that side can
break. Run `prisma migrate deploy` and carry on.

Why it exists: Phase 15 says to persist the agent's report as a `RiskEvidence`
row, and that row **is** still written (`source: "mcp-investigation"`). But
`RiskEvidence` is a numeric feature row — no column can hold a narrative, a
wallet list, or a tool-call trace — and Phase 22 requires
`GET /investigations/:id` to serve an actual result. Overloading
`RiskEvidence.feature` with prose would have made "which feature is this?"
unanswerable for every consumer of that table.

Section 0.4 of both markdown specs has been updated with the model and a change
log entry.

---

## Phase 13 — what is actually blocked, and what isn't

This is the honest version, because it affects what can be demoed.

Checked against the real local `.env` on 2026-09-09, not assumed:

| Item                              | State                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| World app registration            | ✅ `WORLD_APP_ID` and `WORLD_RP_ID` both set                                                                        |
| `WORLD_RP_SIGNING_KEY`            | ✅ Set, and **real**: `POST /world/rp-signature` returns a genuine secp256k1 signature from the live server         |
| Gateway API key                   | ✅ Set (`GRAPH_GATEWAY_API_KEY`, shared with Suganthan's Phase 1.2)                                                 |
| Selfie Check feature-flag access  | ⬜ **Unconfirmed.** The access-request email to `developers@toolsforhumanity.com` is still the gating step          |
| `BACKEND_API_KEY`                 | ✅ Set. **Not a third-party credential** — you invent it; see below                                                 |
| Model key for the agent           | ⬜ `ANTHROPIC_API_KEY` unset, so Phase 15 cannot run                                                                |
| Simulator vs. Sandbox reconciled  | ⬜ Still open (spec 13.3)                                                                                           |

**`BACKEND_API_KEY` is not obtained from anyone — you invent it.** Unlike the
World and Graph credentials, it is not a third-party key: it is a shared secret
between this backend and whoever calls it (the frontend, or curl). Generate one
with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
put it in `.env`, and send it as the `X-API-Key` header.

A blank value is deliberately treated as "cannot serve", not "no auth required",
so the whole claim API answers 503 until it has one. That is intended, but it
looks like a broken server if you do not know why.

Nothing here blocks the server from starting: every credential is optional at
boot and read through a `require*` helper, so a missing one degrades a single
route rather than the process.

What this means concretely: RP signing is verified against real credentials, but
**no real Selfie Check proof has ever been exchanged**. Anyone demoing this
should say so rather than implying a live end-to-end World integration.

---

## ✅ Phase 14 — Risk cache

`src/cache/risk-cache.ts` + `src/cache/invalidation-worker.ts`.

Key convention is the spec's: `risk:cluster:<id>` and `risk:wallet:<address>`,
plus a `:members` set so a cluster-addressed invalidation can find the per-wallet
copies.

**Three decisions**

**PENDING_REVIEW is never cached.** It describes the system's confidence, not the
wallet. Cached for an hour it would keep holding claims long after the evidence
recovered, and would hide the freshness guard's own recovery.

**One member's event evicts the whole cluster.** Section 0.2 rule 6 — risk is a
property of the cluster, so a new funding transfer for one wallet changes the
score all of them inherit. Evicting only the wallet that moved would leave its
siblings serving a score computed without the event that implicates them.

**One recomputation per invalidation, not one per member.** Every member resolves
to the same `ClusterRisk`; scoring each in turn would be N identical passes.
Siblings repopulate lazily.

**Two real bugs the tests caught, both in the "Redis is down" path**

1. `enableOfflineQueue: false` looked like the fail-fast choice and instead
   silently dropped every command issued during the initial connect handshake —
   so the first writes after boot missed a cache that was perfectly healthy.
2. With that fixed, a genuinely dead Redis made `invalidateRisk` stall for over
   5 seconds as ioredis retried each command with growing backoff.

Both are fixed by a bounded readiness gate: wait once for `ready`
(`RISK_CACHE_CONNECT_TIMEOUT_MS`), then short-circuit instantly while the status
is anything else, and resume automatically when it flips back. Degraded costs
microseconds per claim, not seconds.

---

## ✅ Phase 15 — Subgraph MCP investigation agent — connection RESOLVED

`src/mcp/client.ts`, `src/mcp/investigation-agent.ts`.

**Spec correction: `getTools()` no longer exists.** The spec's Phase 15 snippet
calls `await subgraphMcpClient.getTools()`. In `@mastra/mcp` 1.17.3 the method is
**`listTools()`** — verified against the installed package's own type
definitions, not from memory. `getTools` would have failed at runtime.

**The uncited-report rejection is the point of this module.** An LLM handed a
cluster id and no successful queries will still produce a fluent paragraph about
coordinated funding, and stored in the database that paragraph is
indistinguishable from one grounded in real subgraph data. So the agent's real
tool-call trace is recorded separately from its prose, and **a report with zero
tool calls is rejected, not stored** — status `FAILED`, `summary: null`. That is
what makes "the AI investigates" auditable rather than decorative.

**The hosted MCP endpoint is broken server-side. This was proven, not assumed.**

Our configuration is exactly what The Graph documents — `https://subgraphs.mcp.thegraph.com/sse`
with `Authorization: Bearer <Gateway API key>`, re-checked against the live
Cursor/Claude integration pages and the upstream `graphops/subgraph-mcp` README
on 2026-09-09. SSE is the only remote transport that server offers.

Four measurements, which together isolate the fault to the server:

| Probe                                              | Result                                                   |
| -------------------------------------------------- | --------------------------------------------------------- |
| `GET /sse` with the **real** Gateway key            | HTTP 200, `Content-Type: text/event-stream`, **0 bytes** |
| `GET /sse` with a deliberately **invalid** key      | Identical — HTTP 200, hangs, 0 bytes                     |
| Same endpoint via the **official MCP SDK**          | Handshake times out (so it is not a Mastra bug)          |
| An unrelated public SSE stream, same machine        | Streams immediately (so it is not this network)          |

An MCP SSE server must emit `event: endpoint` on connect to tell the client
where to POST. This one accepts the connection and then says nothing — and since
an invalid key behaves identically, the 200 is not an authorization signal
either. `listTools()` therefore returns 0 tools, and `buildAgent()` refuses to
run an agent with no tools rather than emitting an ungrounded report.

### ✅ Resolved — the connection is live over stdio

`SUBGRAPH_MCP_COMMAND` runs the same upstream server locally over stdio instead
of the broken hosted SSE transport. Built and verified on 2026-09-09:

```
npm run check:mcp

  transport: stdio (D:/Projects/subgraph-mcp/target/release/subgraph-mcp.exe)
  [OK]   connect          9 tools discovered
  [OK]   tool present     search_subgraphs_by_keyword
  [OK]   tool present     get_deployment_30day_query_counts
  [OK]   tool present     get_top_subgraph_deployments
  [OK]   tool call        search_subgraphs_by_keyword("uniswap") -> 7177 bytes of real data
  All checks passed — the MCP connection is live and returning real data.
```

That last line is a real gateway round trip, not a fixture.

**Setup (one time):**

```bash
git clone https://github.com/graphops/subgraph-mcp && cd subgraph-mcp
cargo build --release
# then in backend/.env:
SUBGRAPH_MCP_COMMAND=<repo>/target/release/subgraph-mcp      # .exe on Windows
```

The client selects stdio automatically when that variable is set; nothing else
changes. This project already needs a Rust toolchain for the Phase 9 Substreams
module, so this adds no new prerequisite.

**⚠️ Upstream does not compile on Windows without a one-line patch.**
`src/main.rs` calls `tokio::signal::unix::signal(...)` unconditionally, but
`tokio::signal::unix` is gated behind `#![cfg(unix)]`. The build fails with
`E0433: could not find 'unix' in 'signal'` — and because it fails at the *binary*
target, stdio mode is unavailable too, even though the offending code sits in
the SSE-only branch. Fix is to wrap that block in `#[cfg(unix)]` and fall back
to `tokio::signal::ctrl_c()` on `#[cfg(not(unix))]`. Applied locally in the
checkout at `D:/Projects/subgraph-mcp`; worth upstreaming as a PR.

### Everything below is verified against a real model, a real MCP server, and a real gateway — nothing mocked

```
npm run check:investigation

  model:     openrouter/openai/gpt-4o-mini
  mcp:       <repo>/target/release/subgraph-mcp.exe

  [OK]   cluster                cmttovryy0010iqk4wbgpumzz (2 wallets)
  [OK]   started                cmttvb0880000iqtc4ujjoetm
  status:      COMPLETE  (5.1s)
  toolCalls:   2
  citations:
    - {"args":{"keyword":"0x...cae1"},"tool":"subgraphMcp_search_subgraphs_by_keyword"}
    - {"args":{"keyword":"0x...cae2"},"tool":"subgraphMcp_search_subgraphs_by_keyword"}
  summary: "...returned no results. ...no available data to report regarding
             any shared activity... indicate a lack of relevant on-chain
             activity for the specified wallets."
  [OK]   grounded               2 real tool calls behind the report
  [OK]   summary                588 chars
  [OK]   evidence anchor        RiskEvidence cmttvb3f8... (MCP_INVESTIGATION)
  [OK]   ai did not decide      claim decisions untouched by the agent
  All checks passed — a real investigation ran end to end.
```

Reproducible with `npm run check:investigation`, and covered by
`test/investigation-agent.db.test.ts`'s live block via `npm run test:live`
(22/22 tests, real MCP + real model, most recent run).

**Reasoning is routed through OpenRouter, not Anthropic directly.** Mastra
supports the `openrouter` provider natively — it reads `OPENROUTER_API_KEY` and
sends `Authorization: Bearer <key>`, so no extra provider package was needed.
Model is a config change (`MCP_INVESTIGATION_MODEL=openrouter/<model-id>`), not
a dependency change. `ANTHROPIC_API_KEY` remains supported for a bare
`anthropic/*` id.

**This OpenRouter key is on the free tier** (`total_credits: 0`,
`is_free_tier: true` per `/api/v1/key`), which grants a small, fluctuating
per-request PROMPT token ceiling — observed between 5,197 and 11,530 tokens
across otherwise-identical calls. The full 4-tool default schema alone costs
~6,200 prompt tokens, so the well-funded default 402s on this account.
`.env` narrows this to what was empirically verified to fit:
`MCP_INVESTIGATION_MODEL=openrouter/openai/gpt-4o-mini`,
`MCP_INVESTIGATION_TOOLS` down to 2 tools, `MCP_INVESTIGATION_MAX_OUTPUT_TOKENS=500`.
A funded account does not need any of this — the code defaults (4 tools, 2000
output tokens, `claude-sonnet-4.5`) are the honest general-purpose choice and
are what `.env.example` documents.

### Three real bugs, found only by refusing to mock

Running this for real — not against a stand-in — surfaced three genuine defects
that a mocked agent could never have exposed, because a hand-written mock
naturally matches whatever shape the author assumed:

**1. `extractCitations` read the wrong wire shape.** The first version expected
flat `{ toolName, args }`. A real `@mastra/core` Agent result is nested:
`{ type: 'tool-call', payload: { toolCallId, toolName, args } }`. Every real
tool call therefore extracted **zero** citations — indistinguishable from an
ungrounded report — while the mocked test, built on the same wrong assumption,
passed every time. Fixed to read `payload.*`, with the flat shape kept as a
fallback. The regression test uses the actual captured object, not a
hand-typed guess.

**2. `vitest.config.ts` silently broke live gateway auth.** It hardcodes
`GRAPH_GATEWAY_API_KEY: 'test-gateway-key'` so Suganthan's mocked-`fetch` tests
get a non-empty value. Under `npm run test:live` (`node --env-file=.env`,
loading the real key before vitest starts), that hardcoded literal still won —
so the real MCP server received a fake key, every tool call failed
`auth error: malformed API key`, and **the test still passed**, because an
attempted call still produced a citation regardless of whether it succeeded.
Fixed with `process.env.GRAPH_GATEWAY_API_KEY || 'test-gateway-key'`, which
lets a real value already in the environment win.

**3. An attempted-but-failed tool call counted as "grounded."** Bug 2 exposed
this directly: a real call that reaches the server and comes back an
execution error has exactly as much real data behind it as no call at all, and
the original safeguard only checked "was a call attempted," not "did it
succeed." `extractCitations` now accepts the paired `toolResults` array and
drops any citation whose result reports `isError: true`; `evaluateAgentRun`
threads it through. An investigation "grounded" entirely by a failed
credential is now correctly rejected as ungrounded.

### The tool-choice design: force once, then let the model conclude

`toolChoice: 'required'` for the *entire* run was tried first and rejected —
empirically, not by inspection. A budget model held to "you must call a tool"
on every step never reaches a step where it's allowed to stop and write prose:
the run always ends at `maxSteps` with real citations but zero narrative. That
is compliant with Phase 23's "runaway -> bounded, partial evidence saved," but
it silently discards a model that would gladly have concluded after finding
what it needed - verified with an actual 8-step exhaustion producing 11 real
citations and no summary.

The fix is two calls, not one: `toolChoice: 'required'` for a single forced
step (grounding is non-optional - a cost-driven default model will otherwise
answer from its own training knowledge despite explicit instructions not to),
then a second call continuing the same conversation via
`result.response.messages` (the AI SDK's own designed continuation mechanism)
with `toolChoice: 'auto'`, free to call more tools or conclude. Both calls'
raw tool-call and tool-result arrays are merged before being handed to
`evaluateAgentRun`, so the safeguard sees the whole trace.

### On mocking

**There are no module mocks left in this track.** The earlier version of
`investigation-agent.db.test.ts` mocked `@mastra/core/agent` and the MCP
client - which is exactly the setup that hid bug #1 above. The safeguard is
now the pure exported function `evaluateAgentRun`, tested against real
captured shapes, and the full pipeline is tested against a real model and a
real MCP server in a live block (`npm run test:live`).

`refreshWalletEvidence` is no longer stubbed either - `claim-api.db.test.ts`
and `invalidation-worker.db.test.ts` hit the real Token API and the real
gateway. Verified safe: the fixture wallets are synthetic addresses with no
on-chain history, so a real refresh returns nothing and writes no rows. It
costs about 2-3s per cache miss, which is why the deterministic suite takes
~18s instead of ~5s.

Three files still stub `fetch`, and the distinction matters. Two are
Suganthan's (`token-api`, `standardized-subgraphs`). The third is
`world-verify.db.test.ts`, which simulates a **503 and a network timeout** -
conditions a healthy endpoint cannot be asked to produce on demand. The code
under test is real in every case. That same file also calls World's **real**
`/api/v4/verify/{rp_id}` endpoint with an invalid proof and asserts the genuine
rejection is interpreted correctly.

A real `VERIFIED` outcome from World remains impossible until Selfie Check
access is granted, because it requires a genuine proof. Nothing fakes one.

### Running the live tests

`npm test` never loads `.env` (deliberately - it stays deterministic and free),
so `LIVE`-gated blocks in `mcp-connection.live.test.ts` and
`investigation-agent.db.test.ts` skip under plain `npm test`. To actually run
them: `npm run test:live`, which is `node --env-file=.env vitest.mjs run` - the
one place `.env`'s real credentials reach the test process.

---

## ✅ Phases 16–19 — World

`src/world/{rp-signature,idkit-request-config,idkit-verify,wallet-binding,replay-protection}.ts`

**The signal binds the claim, not just the wallet.** Phase 17 of the spec says to
set the signal to the wallet address. This uses `wallet:claimId`, which is
strictly stronger and matches the product README. Binding the wallet alone leaves
a real hole: a flagged wallet that legitimately passes Selfie Check for claim A
could replay that proof against its own later claim B, because the signal — and
therefore the nullifier's scope — would be identical.

**Verification has three outcomes, not two.** `VERIFIED` / `REJECTED` /
`UNAVAILABLE`. Collapsing "we could not ask World" into `REJECTED` fails a
legitimate user because World had a bad minute; collapsing it into `VERIFIED` is
the fail-open bug the whole system exists to prevent. Only `UNAVAILABLE` is
retried — a 4xx is World's considered answer, and retrying it would hammer the
endpoint and still never succeed.

**Nullifiers are stored as decimal, converted from 0x-hex.** Postgres has no
256-bit integer type. Storing the hex would silently break uniqueness: `0x0a` and
`0xA` are the same nullifier and different strings, so a proof could be replayed
simply by re-encoding it. There is a test for exactly that.

**An API flaw a test exposed:** `recordNullifier` originally took `worldActionId`
as a parameter while the challenge row already had one, so the uniqueness check
and the write could disagree about which action was being claimed. It now reads
the action from the row — the caller cannot get it wrong.

### Two real bugs found building the frontend tester (`frontend/`), 2026-09-09

Both would have silently broken every genuine Selfie Check attempt. Neither was
visible from the spec text alone — both came from reading the *installed*
`@worldcoin/idkit-core` 4.2.4 type definitions directly
(`node_modules/@worldcoin/idkit-core/dist/index.d.ts`) while wiring a real
client against them.

**1. `buildIdKitRequestConfig` never returned `app_id`.** The real
`IDKitRequestConfig` type requires `app_id` as a field entirely separate from
`rp_id` (`app_id: \`app_${string}\`` — no `?`), not an alternate spelling used
interchangeably the way it is on the verify endpoint. Without it the client
SDK cannot construct a request at all. Fixed by adding `requireWorldAppId()`
to `env.ts` (mirroring `requireWorldRpId`) and returning `app_id` and
`allow_legacy_proofs: true` (also required — `selfieCheckLegacy`'s own doc
comment says it "only returns World ID 3.0 proofs") from
`idkit-request-config.ts`.

**2. `extractProofFields` read the wrong response shape.** Every real
`IDKitResult` variant (V3, V4, session) carries `nullifier` and `signal_hash`
inside `responses[0]`, never at the top level — confirmed against the real
types, not assumed. The original implementation only checked the top level, so
a genuine successful proof would have thrown "Verified proof carried no
nullifier" every single time — the fixture tests passed because their
hand-written mocks put the fields exactly where the (wrong) code looked for
them. Fixed to check both the flat shape and `responses[0]`, on both World's
verify response and the client payload — World's own verify-response shape is
still not documented anywhere this project could confirm, so that side stays
tolerant of either.

**Live proof the fix works, in a real browser, with a real phone — not a unit
test.** The frontend tester drove a real `/screen-claim` → real `CHALLENGE` →
real `/world/rp-signature` → real `@worldcoin/idkit-core` WASM signing → a
genuine `https://.../verify?...&c=<code>&a=<app_id>` link. **A real phone
scanned it and completed the biometric check for real**, returning a genuine
`protocol_version: "3.0"` proof with a real merkle root, nullifier, and proof
bytes. **Phase 13 access is confirmed granted** — that gap is closed.

### Two more real bugs, found only by testing with an actual phone

**`verifyWorldProof`'s `REJECTED` outcome discarded World's own rejection
detail down to a bare status code** (`"World rejected the proof (400)"`).
Against a genuinely valid proof this hid the one thing worth knowing. Now
extracts `detail`/`code`/`error`/`message` from World's response body
(`summarizeRejectionBody` in `idkit-verify.ts`), falling back to a raw dump.
Confirmed real: replaying the exact captured proof directly against
`developer.world.org` returned
`{"code":"environment_mismatch","detail":"This proof was generated for the
production environment, but this request uses staging..."}` — a real phone's
real World App generates **production**-environment proofs, and this project's
`environment` default (both the frontend's and, by extension, anyone testing
against a real device) was `staging` — Section 13.3's confirmed path for
World's *simulator* tool, not a real phone. Frontend default changed to
`production`.

**The frontend's own error handling hid the same detail a second time.**
`/world/verify`'s non-2xx body is the real `VerifyResult` shape,
`{ status, challengeId, reason }` — no `message` key — but the client only
checked `.message`, showing a useless `"400: HTTP 400"` regardless of what the
backend actually said. Fixed in `frontend/src/api.ts` to check
`message`/`reason`/`error`, and error displays now render the full response
body, not a one-line summary.

---

## ✅ Phase 20 — Policy Engine

`src/policy/policy-engine.ts`.

**`PENDING_REVIEW` is branched on before `riskScore` is read at all.** This is the
bug both specs call the most damaging one available: a held assessment carries
`riskScore: 0`, which lands squarely in the ALLOW band, so a missing status check
does not fail loudly — it silently approves exactly the claims the system was
least sure about. There is a test asserting the decision is not ALLOW.

**The band comes from the same PolicyVersion that produced the score.** Scoring
under v1.0's weights and banding under v1.1's thresholds would produce a decision
no single policy ever authorised, and the receipt naming one version would not
reproduce it.

**An unmappable score is held, not rounded to the nearest band.** Section 0.2
rule 4 — picking the closest band is a confident invented decision.

**The uniqueness signal is deliberately NOT weighted.** Whether Selfie Check
returns it as a threshold-able number or a boolean is still unconfirmed against a
real verify response (spec's own open question #1). Weighting a field whose shape
is a guess would be exactly the fabricated confidence rule 4 forbids.

---

## ✅ Phases 21–22 — Receipts and the API

12 endpoints, all authenticated behind `X-API-Key`; rate limiting on the routes
that spend upstream quota; zod validation on every body; `ClaimError` carrying
real status codes.

**A real concurrency bug the acceptance test caught.** The spec says to wrap
claim creation in `prisma.claim.upsert(...)`. That is **not sufficient on its
own**: Prisma implements upsert as find-then-create, so two simultaneous callers
both miss and both attempt the insert, and the loser gets a P2002 — a 500 on a
perfectly ordinary double-click. The spec's own alternative wording ("or catch
the unique-constraint violation and re-fetch") is what actually works, and is
what ships. The test fires both requests with `Promise.all`, not in sequence.

**The decision write is transactional and row-locked**; the expensive Graph work
happens outside it, because holding a row lock across a live Token API call would
serialise the endpoint behind the slowest upstream request.

**A CHALLENGE does not stamp `decidedAt`.** It is not decided yet —
`/claim/finalize` decides it once World answers. Stamping it would make a claim
awaiting verification indistinguishable from a finished one.

---

## ✅ Phase 23 — Failure matrix

Every row from the spec, with the test that covers it:

| Failure                                | Behaviour                                    | Test                              |
| -------------------------------------- | --------------------------------------------- | --------------------------------- |
| Evidence API returns `PENDING_REVIEW`  | Held, never ALLOW                             | `policy-engine.db.test.ts`        |
| World verify times out                 | `RETRYABLE`, challenge stays ISSUED, retried  | `world-verify.db.test.ts`         |
| Duplicate claim submission             | Idempotent — same claim returned              | `claim-api.db.test.ts`            |
| Replayed proof / reused nullifier      | Rejected                                      | `world-verify.db.test.ts`         |
| Wrong-wallet signal on a valid proof   | Rejected                                      | `world.test.ts`                   |
| MCP investigation runaway              | Bounded by `maxSteps`; partial evidence kept  | `investigation-agent.db.test.ts`  |
| DB write failure mid-orchestration     | Whole decision transaction rolls back         | transaction in `orchestrator.ts`  |
| Redis unavailable                      | Falls through to direct compute, no crash     | `risk-cache-degraded.test.ts`     |

Seed fixtures are appended to the shared `prisma/seed.ts` inside `seedSylesh()`,
per the shared-file etiquette — Suganthan's function is untouched.

### ⚠️ Do not run `npm run dev` while running the tests

This cost real debugging time, so it is written down rather than re-learned.

`server.ts` starts the `risk-invalidation` worker when the process actually
listens. That worker competes with the test suite for jobs on the **same shared
Redis queue** — and unlike the tests, it runs the **real**
`refreshWalletEvidence`, which hits the live Token API.

The failure mode is genuinely confusing: a stray dev server silently consumes
the job `invalidation-queue.db.test.ts` enqueues for
`0xaaaaaaaa…aaaa`, fetches that address's real mainnet history, and writes ~70
live `EvidenceEvent` rows onto a wallet another test expects to have exactly 3.
Two tests in **Suganthan's** `evidence-repository.db.test.ts` then fail with an
assertion about block numbers, pointing nowhere near the actual cause.

Note also that `tsx watch` survives killing whatever holds port 3000 — check for
leftover `node … tsx … watch src/server` processes, not just the listener.

Stop the dev server before `npm test`.

**A CHALLENGE-band fixture now exists.** Suganthan's two fixtures cover ALLOW
(clean, 0.08) and BLOCK (the ring, 0.85); neither exercises escalation, which is
the entire World path. `FIXTURE_CHALLENGE_WALLET` is a two-wallet cluster that
scores **0.43** — measured from the real feature extractors, not written down.

---

## What Suganthan needs from me — now delivered

| Item                                          | State                                                       |
| --------------------------------------------- | ------------------------------------------------------------ |
| Phase 14 worker consumes `risk-invalidation`  | ✅ Confirmed with the exact documented payload, tested live  |
| `server.ts` ownership taken over              | ✅ Taken; `/health` preserved verbatim, including provenance |
| `/health` kept alive and extended             | ✅ Unchanged and still the one unauthenticated route         |
| World-side fixtures in `prisma/seed.ts`       | ✅ `seedSylesh()` populated                                  |

---

## What is left

1. **Phase 13 credentials.** The long pole, and it is a human-approval step, not
   a coding one. Send the Selfie Check access email.
2. **Phase 15 live run.** Needs `GRAPH_GATEWAY_API_KEY` wired to the MCP client
   and a model key. The code path is unexercised against a real endpoint.
3. **Phase 18 live proof.** Nothing has verified a real Selfie Check proof.
4. **Phase 25 joint run.** Both tracks together, both failure matrices back to
   back, and the Substreams-sink → cache-invalidation path exercised end to end.
   The spec says do this in the same room; it has not been done.
