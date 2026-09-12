# Phase 6 — ERC-8004 agent trust

**Status:** Complete
**Date:** 2026-09-12
**Spec:** §33 Phase 6, §4.3, §16

**Done when:** *"An agent's TrustSnapshot includes ERC-8004-derived evidence where available."* — met. `agentReputation` was the last dimension still hardcoded to UNKNOWN; it is now read from the live registries.

---

## 1. Live registries, cross-verified

| Registry | Sepolia | Bytecode |
|---|---|---|
| Identity | `0x7177a686…36Dd09A` | 6,884 B |
| Reputation | `0xB5048e3e…869e322` | 8,852 B |
| Validation | `0x662b40A5…eEE66d8` | 4,326 B |

The check that matters: **both Reputation and Validation return exactly the configured Identity address** from `getIdentityRegistry()`. That's what proves these are one matched deployment rather than three addresses that happen to have code. `npm run check:erc8004` asserts it every run.

Agent id 1 is genuinely registered, owner `0x9B4Cef62…`.

---

## 2. The EIP is a draft, and the deployment has diverged

Two differences found by calling the chain, either of which silently breaks the integration:

**Tags are `bytes32`, not `string`.**
```
EIP draft : getSummary(uint256, address[], string,  string)
deployed  : getSummary(uint256, address[], bytes32, bytes32)
```
The documented signature simply isn't in the bytecode.

**`getSummary` returns two values, not three.** The EIP specifies `(count, summaryValue, summaryValueDecimals)`. The deployed contract returns exactly **64 bytes** — confirmed by raw `eth_call` and hexdump. Decoding with the documented shape throws *"Position 95 is out of bounds"*, which is how this surfaced.

Every selector in the adapter was confirmed present in the deployed bytecode before it was written down.

**Consequence, stated honestly:** without `valueDecimals` the scale can't be read from the summary, so it's a config value (`ERC8004_SUMMARY_VALUE_DECIMALS`, default 0). It is **unverified against real data** — no agent on this deployment carries feedback yet, so there is nothing to calibrate against. If that changes, confirm the scale via `readFeedback`, which does return decimals.

---

## 3. Reputation is never invented

`agentReputation` returns **null (UNKNOWN)** whenever there is nothing real to measure:

- no ERC-8004 id linked to the actor
- an id not present in the registry
- **a registered agent with zero feedback and zero validations**

That last one is the important case. Zero feedback is not zero reputation and it is not perfect reputation — it's an absence of evidence. Mapping it to 0 would read as "rated badly"; mapping it to 1 would hand a brand-new agent a perfect score, which is exactly the free-trust bug ERC-8004's tiered model exists to avoid. Three tests assert it stays null.

**Validations outweigh feedback** (0.6 / 0.4) when both exist. Feedback is an opinion anyone can post; a validation is a check a validator contract actually performed. There's a test where a perfect feedback score plus one failed validation lands at 0.4 — below halfway.

---

## 4. Failure is soft, and reported

Each registry is read independently; a failure in one is recorded in `errors[]` rather than aborting the others. Partial external evidence is still evidence, and losing a good reputation read because the validation registry hiccuped would make the trust vector needlessly blind.

An unreachable registry leaves the dimension unmeasured — it never fails the whole trust build. External reputation is one signal of seven.

---

## 5. Storage is a reference, not a mirror

§16.1 is explicit: don't copy registry state into every actor row. `POST /v2/agents/:id/erc8004` stores only the id, and **verifies it against the live registry first** — a typo becomes a 404 now rather than a permanently unmeasurable dimension later.

---

## 6. Verification

```
typecheck clean · lint clean
538 passed | 5 skipped | 0 failed  (543 total, 38 files)
three consecutive clean runs
```

+8 over Phase 5.5. `npm run check:erc8004` passes against the live registries.

---

## 7. Carried forward

1. **Nothing registers an agent in ERC-8004.** Xander reads the registries; it doesn't write to them. §4.3 says Xander consumes rather than replaces, so this may be correct as-is — but it means an agent's id must be supplied from outside.
2. **The summary scale is unverified** (§2). Blocked on real feedback existing on this deployment.
3. **No caching yet.** `ERC8004_CACHE_TTL_SECONDS` exists and is unused; every trust build with a linked agent makes three RPC calls.
4. **Validation `getValidationStatus` is unused** — only the summary is consumed.
