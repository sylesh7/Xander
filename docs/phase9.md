# Phase 9 — x402 agent commerce

**Status:** Complete
**Date:** 2026-09-12
**Spec:** §33 Phase 9, §17, §4.6

**Goal (spec):** *"Prove Xander works outside claims."*

**Demo (spec):** trusted agent → paid request allowed · unknown agent → tiny allowance · suspicious agent → denied.

---

## 1. Protocol version: v2, not v1

The x402 repository ships **two incompatible specifications**, and this matters more than anything else in the phase:

| | v1 | v2 |
|---|---|---|
| client → server | `X-PAYMENT` | **`PAYMENT-SIGNATURE`** |
| server → client | `X-PAYMENT-RESPONSE` | **`PAYMENT-RESPONSE`**, `PAYMENT-REQUIRED` |
| network naming | `base-sepolia` | **CAIP-2** `eip155:84532` |
| amount field | `maxAmountRequired` | **`amount`** |

I checked the live facilitator before writing a line:

```
GET https://x402.org/facilitator/supported
{"kinds":[{"x402Version":2,"scheme":"exact","network":"eip155:84532"}, ...]}
```

It answers **v2**. Building v1 from memory would have produced a client nothing reachable still speaks. Everything in `x402-types.ts` is transcribed from `specs/x402-specification-v2.md` and `specs/transports-v2/http.md`.

Base Sepolia USDC was verified on-chain rather than assumed — `name() = "USDC"`, `version() = "2"`, `decimals() = 6`. Those three feed the EIP-712 domain; guessing any of them yields a signature the token rejects.

---

## 2. The two decisions that define this phase

### A denied agent gets **403, never 402**

A 402 is an *invitation to pay*. Sending one to an agent we have already refused would solicit money for a service that will never be delivered, however much it pays. Anomalous actors are turned away **before any price is quoted**, and there is a test asserting the `PAYMENT-REQUIRED` header is absent on a refusal.

An *exhausted allowance* gets **429**, not 403 — the agent is legitimate and the answer will differ later.

### Verify before serving, settle after

```
policy → allowance → validate payload → /verify → Phase 8 gate → SERVE → /settle → receipt
```

Serving first risks giving the resource away to an invalid signature. Settling first risks charging for a response that then failed. Verification is free and reversible; settlement is neither.

---

## 3. The ladder is policy ROWS

§17's rate ladder is five rows in `PolicyRule`, priorities 52–56 — not a `switch`. Repricing agent commerce is an `UPDATE` (§0.2 rule 1).

| band | effect | rate |
|---|---|---|
| `HIGH_RISK`, `CRITICAL` | BLOCK | 0 |
| `VERIFIED_LOW` | LIMIT | 5000 / hour |
| `ESTABLISHED_LOW` + live assurance | LIMIT | 500 / hour |
| `ESTABLISHED_LOW`, no assurance | LIMIT | 10 / day |
| `UNCERTAIN` | LIMIT | 10 / day |

The allowance is enforced as a **`Capability` frequency limit**, so counting, windowing and exhaustion are Phase 3's already-tested machinery rather than a second rate limiter that could disagree with the first. Phase 8's gate then runs immediately before the resource is served.

**Policy version bumped `v2-1.0` → `v2-1.1`.** Rewriting a published version's rules in place would make every receipt already citing `v2-1.0` describe a rule set that no longer exists, and §3.6's "every decision stores the policy version that judged it" would become a lie.

---

## 4. A mistake I made and reverted

My first draft added **rule 15**: an `INSUFFICIENT_EVIDENCE` exception so that §17's "new agent → 10 requests/day" would be literally reachable for a brand-new wallet. I justified it as safe because x402 is prepaid.

**It was wrong and I removed it.** `createIntent` holds an unmeasurable actor for REVIEW at the §27.5 fail-closed gate, *before* the policy table is consulted — that is the product's central safety property. I had carved a hole in it to satisfy a line of demo wording. Prepayment bounds what an attacker spends; it does not make an actor measurable, and invariant 3.2 outranks a convenience rung.

The resolution is that "new agent" in Xander means an agent **with an identity and assurance** — which gives it the evidence the table needs — not an anonymous wallet. The bottom rung is `UNCERTAIN`, which is reachable and correct. The reasoning is recorded in the seed file so nobody re-adds it.

---

## 5. A test that proved nothing

The first run of `v2-x402.db.test.ts` was **16 green ticks in 62 ms**. All of them were no-ops.

`vitest.config.ts` deliberately does not read `.env`, so `X402_PAY_TO` was unset, `x402Availability()` reported the surface disabled, and every test guarded itself into an early `return`. Exactly the Phase 7 failure mode. Fixed by adding the setting to `vitest.config.ts` with a comment explaining why it must be there.

The rewrite also dropped a second bad habit: the original forced trust bands by writing `overallBand` onto snapshots. Every code path recomputes the trust context from evidence, so the forgery was overwritten and the tests were asserting against `INSUFFICIENT_EVIDENCE` in every case — one of them "passed" for entirely the wrong reason. The ladder is now tested by running the **real rule engine over the real seeded rows**, and the service is tested against real actors asserting what genuinely happens.

Now: **19 tests, ~12 s of real work.**

---

## 6. Live proof on Base Sepolia

`npm run check:x402` runs the real Express app on an ephemeral port and talks to it with `fetch` as a paying agent would — no supertest, no direct service calls. Real EIP-3009 signature, real x402.org facilitator, real testnet USDC.

Recipient `0x6475a1E1360D6D9DB583B16D83c7dF6745FFb959` is receive-only; Xander never holds its key and never signs a payment.

The payer's band came out **`UNCERTAIN`** from its own real evidence (11 rows, plus a live base-sepolia Substreams cursor) — no evidence was seeded to make the demo work.

---

## 7. A real bug the live run found

The first settlement attempt failed with:

```
/verify  -> { isValid: true }
/settle  -> { success: false, errorReason: "invalid_exact_evm_transaction_failed" }
```

Verification passed and settlement still reverted. Cause: `maxTimeoutSeconds: 60`, copied from the specification's example. Between the client signing and the facilitator broadcasting, Xander rebuilds the payer's trust context **twice** (once in `authorizePaidRequest`, once inside `createIntent`) and runs the policy engine — live work that can take tens of seconds. The authorization expired in flight and the token reverted.

Raised to **300 s**, with the observation recorded in `env.ts` so nobody trims it back to match the spec example.

This is a good argument for the ordering in §2: because settlement happens last, a failure here costs nothing — the agent was never charged.

### And a bug in my own check

The script then reported `RECIPIENT WAS PAID: expected +1000, saw +0` for a payment that had demonstrably settled — the recipient's balance was visibly rising between runs. Three attempts to verify it:

1. Read `balanceOf` right after `/settle` returned. **Wrong** — the facilitator returns once it has *broadcast*, not once the transfer is mined.
2. Wait for the receipt, then read `balanceOf`. **Still wrong** — `sepolia.base.org` is load-balanced, so a `latest` read can land on a node that has not yet seen that block.
3. Read `balanceOf` at pinned blocks straddling the settlement. **Hung** — historical state needs an archive node, which the public endpoint does not serve. (This one was caught only because the run stopped producing output; it would otherwise have looked like a slow network.)

The answer was to stop differencing balances entirely and decode the ERC-20 `Transfer` event **out of the settlement receipt we already hold**. It needs no second RPC call, no archive state and no `latest` read, and it proves something stronger: that this exact amount reached this exact recipient *in this exact transaction*, rather than inferring it from a balance anything could have moved.

```
[OK]   settlement mined      block 46728953
[OK]   RECIPIENT WAS PAID    +1000 atomic units in block 46728953
[OK]   payer actually spent  1000 atomic units
```

All three were faults in the verification, not the product. Worth recording because the tempting "fix" at step 1 was to loosen the assertion, which would have left the phase unproven while looking green.

---

## 8. Cumulative regression, Phase 0 → 9

| check | result |
|---|---|
| `npm test` × 3 consecutive | **624 passed, 5 skipped, 0 failed** — identical every run |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run check:x402` | **17/17**, real settlement mined on Base Sepolia |
| `npm run check:enforcement` | 13/13 (Phase 8, live Sepolia) |
| `npm run check:graph` / `check:ens` / `check:erc8004` | all OK |

Test count 584 → **624** (+40: 21 pure, 19 db/HTTP).

---

## 9. Files

| file | role |
|---|---|
| `src/x402/x402-types.ts` | v2 wire types, base64 headers, CAIP-2, payload validation — pure |
| `src/x402/x402-facilitator.ts` | typed wrapper over `/verify`, `/settle`, `/supported` |
| `src/x402/x402-client.ts` | the paying agent's EIP-3009 signer |
| `src/x402/x402-service.ts` | price → authorize → verify → gate → settle → receipt |
| `src/x402/x402-routes.ts` | the protected surface |
| `prisma/seed-data/policy-rules.ts` | §17's ladder as rows (52–56) |
| `scripts/check-x402.ts` | live end-to-end (`npm run check:x402`) |
| `test/x402-types.test.ts` | 21 pure tests |
| `test/v2-x402.db.test.ts` | 19 tests, real Postgres + real HTTP |

**Migration** `add_x402_payment` adds `X402Payment`. Written at **every** outcome including refusals — "who was turned away and why" is the question an operator actually has, and a table of successes cannot answer it. `nonce` is `@unique`: EIP-3009 authorizations are single-use and the database constraint is what makes that true under a race, where check-then-insert would not.

**Routes** (no API key — in x402 the payment *is* the authorization):
`GET /x402/risk-report`, `GET /x402/info`, `GET /x402/payments/:actorId`

The router is mounted **before** `apiRouter` in `server.ts`: the V1 claim router calls `apiKeyAuth` with no path prefix, so anything mounted after it inherits the key requirement. `/x402/info` returned 401 until the order was fixed. A test now guards it.

---

## 10. What is sold

A live Xander trust report for a wallet — deliberately not a toy payload. It is genuinely something an agent would buy, and it makes the phase's point by selling the very thing Xander computes.

---

## 11. Carried forward

- **Solana / other CAIP-2 networks.** The facilitator advertises Solana, Algorand, Aptos and Stellar. `chainIdFromCaip2` returns `null` for non-EVM rather than guessing, and the signer refuses. EVM-only, stated plainly.
- **The `upto` and `batch-settlement` schemes** are advertised by the facilitator and not implemented; only `exact`.
- **Discovery / Bazaar** (`GET /discovery/resources`) is not implemented — Xander is not listed as a discoverable resource.
- **Two trust rebuilds per paid request** is wasteful and is what forced the 300 s window. Worth collapsing to one.
- Carry-forwards from earlier phases are unchanged (no TrustSnapshot retention, no ENS renewal, no route starts a Temporal workflow, ERC-7715 not implemented).
