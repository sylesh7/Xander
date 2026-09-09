# Xander Claim Gate API — frontend contract

**Owner:** Sylesh (Backend-Sylesh.md Phases 17, 22, 25).
**Status:** frozen. Phase 25 requires this to be settled before frontend work starts.

Base URL in local dev: `http://localhost:3000`.

---

## 1. Auth

Every route below requires a shared key:

```http
X-API-Key: <BACKEND_API_KEY>
```

`BACKEND_API_KEY` is **self-issued**, not a credential from World or The Graph —
the backend operator generates a random string, sets it in `.env`, and shares it
with the client. Ask whoever runs the backend for the value; do not hardcode it
into frontend source that ships to a browser.

`GET /health` is the one exception — an uptime check must not need a credential
that can rotate out from under it.

Responses:

| Status | Meaning |
| ------ | ---------------------------------------------------------------------------- |
| `401`  | missing or wrong key |
| `429`  | rate limited (`/screen-claim` and `/world/*`, `RATE_LIMIT_MAX_REQUESTS` per window) |
| `503`  | `BACKEND_API_KEY` is not configured on the server, so the route cannot be served |

A missing server key is deliberately a 503 and never an open door.

---

## 2. THE ORDERING RULE — read this before writing any World code

**`POST /world/rp-signature` must be called BEFORE the client opens IDKit.**

This is the single most common way to get the World flow wrong. Without a valid
RP signature IDKit does not open, and it does not report a missing signature as
the reason. The signing key is server-side only and never reaches the client.

The full escalation sequence:

```
POST /screen-claim          -> 202 CHALLENGE  (returns an `idkit` config block)
POST /world/rp-signature    -> { sig, nonce, created_at, expires_at }
   ... client opens IDKit with the returned signature + the `idkit` block ...
POST /world/verify          -> PASSED | FAILED | RETRYABLE
POST /claim/finalize        -> ALLOW | BLOCK
GET  /receipts/:id          -> the full decision trail
```

---

## 3. Endpoints

### `POST /screen-claim`

The main entry point. Idempotent per `{wallet, campaignId}` — calling it twice
returns the same claim, and two concurrent calls produce one claim and one
challenge, not two.

```jsonc
// request
{ "wallet": "0x…40 hex chars", "campaignId": "airdrop-2026" }
```

```jsonc
// 200 (ALLOW / BLOCK / PENDING_REVIEW) or 202 (CHALLENGE)
{
  "claimId": "cmtt…",
  "decision": "ALLOW" | "CHALLENGE" | "BLOCK" | "PENDING_REVIEW",
  "clusterId": "cmtt…" | null,
  "riskScore": 0.43,
  "requiredAssurance": "SELFIE_CHECK" | null,
  "evidenceReceiptId": "cmtt…" | null,
  "verificationChallengeId": "cmtt…" | null,
  "idkit": {                      // present only on CHALLENGE
    "rp_id": "rp_…",
    "action": "claim-airdrop-2026",
    "preset": "selfieCheckLegacy",
    "signal": "0xwallet…:claimId"
  },
  "reason": "human-readable explanation of the decision",
  "cached": false
}
```

**Handle all four decisions.** `PENDING_REVIEW` means the evidence was stale or
a Graph query failed — the claim is held. It is **not** an allow, and it is not
an error either; retrying later can produce a real answer.

### `POST /world/rp-signature`

```jsonc
// request
{ "action": "claim-airdrop-2026" }   // use the `action` from the idkit block
```

```jsonc
// 200
{
  "sig": "0x…",
  "nonce": "…",
  "createdAt": 1757000000, "expiresAt": 1757000300,
  "created_at": 1757000000, "expires_at": 1757000300
}
```

Both casings are returned so neither IDKit (camelCase) nor the spec's own
acceptance shape (snake_case) needs remapping. Use whichever your client wants.

### `POST /world/verify`

Forward the IDKit result **exactly as received**. Do not remap, rename, or
reshape any field — the backend passes it to World untouched, and remapping is
where this call usually breaks.

```jsonc
// request
{ "claimId": "cmtt…", "idkitResponse": { /* verbatim IDKit result */ }, "rp_id": "rp_…" }
```

```jsonc
// 200 PASSED | 400 FAILED | 503 RETRYABLE
{ "status": "PASSED", "challengeId": "cmtt…", "reason": "…" }
```

`RETRYABLE` (503) means World could not be reached — **not** that the user
failed. The challenge stays open; retry the same call.

### `POST /world/challenge`

Re-issues a challenge whose prompt expired. Not for initial issuance — that
happens inside `/screen-claim`.

```jsonc
{ "claimId": "cmtt…" }   // -> { claimId, challengeId, reused, idkit }
```

### `POST /claim/finalize`

Resolves a `CHALLENGE` into its final decision after verification.

```jsonc
{ "claimId": "cmtt…" }
// -> { claimId, decision: "ALLOW" | "BLOCK", evidenceReceiptId, worldChallengeId, reason }
```

Returns `409` while verification is still outstanding. It never defaults: an
unanswered challenge is neither allowed nor blocked.

### `GET /receipts/:id`

**This is what powers any "why was this wallet flagged?" UI.** Its shape is the
contract — do not improvise around it.

```jsonc
{
  "id": "cmtt…", "claimId": "cmtt…", "wallet": "0x…", "clusterId": "cmtt…",
  "decision": "CHALLENGE", "riskScore": 0.43, "confidence": "MEDIUM",
  "features": [{ "name": "FUNDING_CORRELATION", "value": 1 }],
  "sources":  [{ "type": "token-api", "deployment": null, "block": "3049000" }],
  "policyVersion": "1.0",
  "requiredAssurance": "SELFIE_CHECK",
  "worldChallengeId": "cmtt…",
  "createdAt": "2026-09-09T…"
}
```

Reconstructs the decision without re-querying The Graph or World.

### `GET /clusters/:id` and `GET /clusters/:id/evidence`

Cluster summary, and the underlying evidence with provenance attached
(`sourceType`, `deploymentId`, `blockNumber`). Supports `?limit=` (default 200,
max 1000).

### `GET /wallets/:address/risk`

Current risk, served through the cache. Returns the `ClusterRisk` shape plus
`cached: boolean`.

### `POST /investigations` and `GET /investigations/:id`

Starts a Subgraph MCP investigation of a flagged cluster; returns `202` with an
id to poll.

```jsonc
// GET /investigations/:id
{
  "id": "cmtt…", "clusterId": "cmtt…", "wallets": ["0x…"],
  "status": "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED",
  "summary": "…narrative…" | null,
  "citations": [{ "tool": "subgraphMcp_executeQuery", "args": { … } }],
  "toolCalls": 2, "model": "anthropic/claude-sonnet-4-5",
  "finishReason": "stop", "error": null
}
```

`status: "FAILED"` with `summary: null` and an `error` mentioning tool calls
means the report was **rejected as uncited** — the agent produced prose without
querying anything, so it was not stored. Do not surface a rejected report as a
finding. The investigation never affects the decision.

### `GET /campaigns/:id`

```jsonc
{
  "campaignId": "airdrop-2026", "totalClaims": 120,
  "decisions": { "ALLOW": 95, "CHALLENGE": 20, "BLOCK": 5 },
  "challenges": { "ISSUED": 12, "PASSED": 7, "FAILED": 1 },
  "distinctClusters": 4,
  "escalationRate": 0.1667
}
```

`escalationRate` is the product thesis as a number: the fraction of claimants
asked for biometrics at all.

### `GET /health`

Unauthenticated. `{ ok: true, provenance: { tokenApi, deployments, substreams } }`.

---

## 4. Types worth getting right

- **Block numbers are strings.** They exceed `Number.MAX_SAFE_INTEGER`. Never
  `parseInt` them for comparison.
- **On-chain amounts are strings.** Never floats.
- **Wallet addresses** must be `0x` + 40 hex characters; anything else is a 400.
- **`riskScore` maxes out at 0.85**, not 1.0 — an unallocated `RESERVE` weight
  holds the remaining 0.15 (see `docs/RISK-MODEL.md`). A wallet scoring 0.85 is
  at the top of the scale.

## 5. Language

Selfie Check returns a **medium-assurance uniqueness signal**. Never call it a
"Sybil score" — that phrase appears nowhere in World's documentation and is
wrong in UI copy, in the pitch, and in code comments.
