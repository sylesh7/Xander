# Phase 3.5 — ENSv2 identity + EAC enforcement

**Status:** Core complete (identity + roles live on-chain)
**Date:** 2026-09-12
**Not in the V2 spec** — inserted after Phase 3 because `Capability` is what EAC maps onto. Spec numbering is unchanged: Phase 4 is still Temporal.

---

## 1. What is live on Sepolia

Real transactions, real contracts, real money (well — testnet USDC).

| Thing | Value |
|---|---|
| Parent name | **`xander.eth`**, expires 2027-09-12 |
| Agent registry | `0x8993Df8b8f5C10d9B3d157B7191431429c51F039` |
| Agents | **`alpha.xander.eth`**, **`beta.xander.eth`** — expire 2026-10-12 |
| Operator | `0xCD8F91DC7929E973DDc071838904434297aB4673` |
| Registration tx | `0x6906c5fc873a742d7dc7bf6b8b249326c4351fb12da879101952f544b187f095` |

```
xander.eth  ──setSubregistry──▶  our own PermissionedRegistry
                                   ├── alpha.xander.eth   (30-day on-chain expiry)
                                   └── beta.xander.eth    ├── EAC role CLAIM        ✅
                                                          ├── EAC role API_REQUEST  ✅
                                                          └── EAC role TRADE        ❌ revoked
```

`npm run check:ens` and `npm run check:ens-agent` both pass end to end against live Sepolia.

---

## 2. What makes this central, not cosmetic

Three properties Xander could not have without ENS:

1. **Agent identity is time-bound on-chain.** `register(..., uint64 expiry)` — an agent's name lapses in 30 days by default. Not a database column anyone with DB access could edit.
2. **Freeze is a real revocation.** `revokeRoles` is a transaction. The check proves it: after revoking TRADE, `hasRoles(TRADE)` is **false** and `hasRoles(CLAIM)` is still **true** — scoped, not blanket.
3. **The parent relationship is the human-backing claim.** `alpha.xander.eth` says publicly whose agent it is. `AGENT_BACKED_BY` becomes a fact anyone can verify.

---

## 3. The honest boundary — stated in the code, not just here

**EAC roles are boolean.** They express *who may act on what*. They carry no amount ceiling, no rate limit, and no expiry of their own (a **name** expires; a **role** does not).

```
ENS carries:   who may act on what, and revocation of that authority
Xander keeps:  how much, how often, and for how long
```

So `Capability.amountLimit` (500 USDC) and `frequencyLimit` (20/day) have **no on-chain counterpart**. Claiming EAC enforces them would be false and trivially caught by anyone reading the EAC docs. That paragraph is at the top of `eac-roles.ts` so it can't quietly drift.

`grantAgentRoles` reports unsupported actions back to the caller rather than dropping them — the live check deliberately passes `TREASURY_TRANSFER` to prove it comes back flagged.

---

## 4. Five things the docs did not say, learned by doing

Every one of these was found by calling the chain, not by reading.

### 4.1 Rent is an ERC20, not ETH
`getRegisterPrice(..., address(0))` reverts `PaymentTokenNotSupported(address)` — selector `0x02e2ae9e`, identified by brute-forcing candidate signatures since 4byte had no entry. Payment is **Circle's Sepolia USDC** (`0x1c7D…7238`), confirmed by reading `name`/`symbol`/`decimals` off the token *and* by the rent oracle answering `isPaymentToken()` true. `xander.eth` cost **8.000021 USDC/year**.

The oracle address isn't documented either — found by probing getters until `rentPriceOracle()` answered (`0x8914…8987`).

### 4.2 Mutable Token IDs — the dangerous one
An ENSv2 token id is **not** the labelhash. It's the labelhash with its **low 32 bits replaced by a version counter**:

```
labelhash("xander") = 0x5402…5b96 33b981a4
actual token id     = 0x5402…5b96 00000000
```

This fails **silently**. `ownerOf(labelhash)` returns the zero address, so a freshly registered name reads back as unregistered. My first post-registration read said `owner: 0x0` despite `status: success` — I nearly concluded the transaction had failed. Caught it by pulling the real id out of the `TransferSingle` log.

### 4.3 `getState` returns five words, not two
Docs say only "a State struct". It's `(status, expiry, owner, tokenId, canonicalId)`. My two-output guess decoded `status` **as** the expiry, which is why unregistered names appeared to "expire in 1970".

### 4.4 `verifyContract` returns an address, not a bool
It returns the **implementation** the proxy was deployed from. A `bool` ABI made viem reject the 20-byte response — and those bytes decoded to `UserRegistryImpl`. Real verification is comparing that against the expected implementation, which is what the script now does.

### 4.5 Holding a name does not let you grant roles on it
EAC pairs every role with an **admin** role controlling who may grant it. Registering `alpha.xander.eth` with only the tutorial's `REGISTRATION_ROLE_BITMAP` meant the owner could not grant its own agent roles — `grantRoles` reverted `0xd1a3b355`, a custom error in neither 4byte nor any ABI.

Fix: `AGENT_REGISTRATION_ROLE_BITMAP` includes the admin bit for every agent role. Granting them at registration is also least-privilege — the authority is scoped to that one subname's resource rather than taken at `ROOT_RESOURCE`, where it would apply to every name in the registry.

`alpha` was registered before this fix and therefore can't be granted roles; `beta` is the corrected one. Left as-is rather than re-registered — it's honest evidence of the sequence, and re-registering would only spend gas.

---

## 5. Verification

```
typecheck   clean
lint        clean
tests       480 passed | 5 skipped | 0 failed   (485 total, 34 files)
            three consecutive clean runs
```

Up from Phase 3's 465 → **+15 tests**, all pure (`test/ens-roles.test.ts`). Still zero `vi.mock()`.

The unit tests guard the two rules that fail *silently* on-chain: nybble-vs-bit role shifts, and canonical-vs-raw token ids. One test asserts the exact token id observed on-chain for `xander.eth`, so a regression in the derivation is caught without an RPC.

Two design assertions worth noting:
- agent roles can never collide with name-management roles (indices 0–2 vs 8–14)
- registration grants **admin** rights but **not** the regular roles — capabilities are granted per action after policy decides, never implied by holding a name

---

## 6. Files

**New**
```
src/ens/ens-client.ts       clients + ABIs, all addresses from config
src/ens/ens-names.ts        canonical token ids, label validation
src/ens/eac-roles.ts        role bitmap arithmetic (pure)
src/ens/agent-identity.ts   register / grant / revoke / read
scripts/check-ens.ts              live contract + ABI verification
scripts/check-ens-agent.ts        full lifecycle, on-chain
scripts/ens-register-parent.ts    commit-reveal, ERC20 approve
scripts/ens-deploy-registry.ts    factory deploy + setSubregistry
test/ens-roles.test.ts            15 pure tests
```

**Modified:** `src/config/env.ts` (13 ENS settings, addresses as config), `package.json` (viem 2.56.3 + 4 scripts).

No V1 or V2 database table changed. Nothing in the existing request path calls ENS yet.

---

## 7. Carried forward

1. **Not wired into the intent flow yet.** `grantCapability` does not mirror to `grantAgentRoles`, and `checkCapability` does not consult `hasOnChainRole`. That's the remaining integration and it belongs with Phase 8 enforcement.
2. **`alpha.xander.eth` can't be granted roles** (registered pre-fix). Use `beta` or a fresh label.
3. **No `Agent` DB model yet** — that's Phase 5. Today ENS identity exists on-chain but has no `ActorIdentity(kind:'ENS')` row beside it.
4. **Renewal is unimplemented.** Agent names expire in 30 days; nothing renews them. Natural fit for Phase 4's Temporal capability-lease workflow.
5. **Sepolia only.** Addresses are config, so mainnet is a `.env` change — but ENS warns the contracts may change before mainnet.
