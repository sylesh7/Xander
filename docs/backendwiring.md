# Xander — Backend Wiring Reference

**Companion doc:** `frontendfinal.md` (what to build). This doc is **how to call it**.
Every shape below was read out of the route handlers, not from memory.

**Base URL:** `http://localhost:3000` (dev) · `PORT` env var
**Content type:** `application/json` on every request with a body.

---

# 0. THE FOUR SURFACES — read this before anything else

There are four routers with **three different auth models**. This is the single biggest source of wasted time.

| # | Surface | Prefix | Auth | Rate limited |
|---|---|---|---|---|
| 1 | **V1 Claim Gate** | `/screen-claim`, `/world/*`, `/claim/*`, `/receipts/*`, `/clusters/*`, `/wallets/*`, `/investigations*`, `/campaigns/*` | `X-API-Key` | some routes |
| 2 | **V2 Trust Runtime** | `/v2/*` (except `/v2/control/*`) | `X-API-Key` | some routes |
| 3 | **x402 commerce** | `/x402/*` | **NONE** | no |
| 4 | **Remote Authority** | `/v2/control/*` | `Authorization: Bearer` **+** `X-Device-Id` | **yes, 60/min** |
| — | **Probes** | `/health`, `/ready` | **NONE** | no |

### Mount order matters (and explains a confusing 401)

`x402Router` and `controlRouter` are mounted **before** the V1 router, because the V1 router applies `apiKeyAuth` with no path prefix. If you add a new unauthenticated route after `apiRouter`, it will inherit the API-key requirement and 401 for no visible reason.

### ⚠️ The API key does NOT work on `/v2/control/*`

This is deliberate (spec §27.1: *"Do not reuse a static protocol API key as a mobile-user credential"*). Sending `X-API-Key` to a control route returns **401**. There is a test asserting this.

### Two clients, never one

```ts
// lib/api/console.ts   → X-API-Key          (surfaces 1 + 2)
// lib/api/authority.ts → Bearer + X-Device-Id (surface 4)
// x402 → plain fetch, no auth header at all
```

---

# 1. Conventions that hold everywhere

### Errors

Every handled error returns:
```jsonc
{ "error": "snake_case_code", "message": "Human sentence." }
```

| Code | Meaning | Frontend treatment |
|---|---|---|
| `400` | zod validation or bad input | inline field errors |
| `401` | missing/invalid credential | re-auth |
| `402` | **payment required** — not an error | render the payment card |
| `403` | refused by policy | `<ReasonPanel>` |
| `404` | not found | `<EmptyState>` |
| `409` | state conflict / already decided / binding mismatch | `<ReasonPanel>` |
| `429` | rate limited or allowance exhausted | `<ReasonPanel>` + retry hint |
| `503` | upstream unavailable (World, facilitator, Temporal) | "try again", **never** treat as a denial |
| `5xx` | genuine bug | error toast |

zod failures come back as:
```jsonc
{ "error": "invalid_request", "message": "...", "issues": [ /* zod issues */ ] }
```

### Types

- **All amounts are decimal strings in base units.** `"1000000"` = 1 USDC (6dp). Never a JSON number — a `uint256` does not survive IEEE-754. Use `BigInt` client-side.
- **All timestamps are ISO 8601 strings** (`2026-09-13T10:04:11.123Z`).
- **Block numbers are strings** — they exceed `Number.MAX_SAFE_INTEGER`.
- **`null` means UNKNOWN.** Never render as `0`. See §3.2.
- Ids are cuids (`cmtyh53wd0001i9uc3a1kb0b7`).

### Rate limits

- `upstreamRateLimit` on routes that spend Graph/World quota (`POST /screen-claim`, `POST /v2/intents`, `GET /v2/actors/:id/trust`, `/world/*`). Default 30/min in prod.
- Control plane: `CONTROL_RATE_LIMIT_MAX` = **60 per 60s**, applied to `/v2/control/*` as a whole.

### Enums — the complete list

```ts
ACTOR_TYPES     = ['WALLET','AGENT','ORGANIZATION','HUMAN']
ACTION_TYPES    = ['CLAIM','VOTE','MINT','TRADE','BORROW','TRANSFER',
                   'API_REQUEST','X402_PAYMENT','AGENT_DELEGATION']
TRUST_BANDS     = ['VERIFIED_LOW','ESTABLISHED_LOW','UNCERTAIN',
                   'HIGH_RISK','CRITICAL','INSUFFICIENT_EVIDENCE']
DECISIONS       = ['ALLOW','LIMIT','CHALLENGE','REVIEW','BLOCK']
AGENT_STATUSES  = ['DRAFT','VERIFYING','HUMAN_BACKED','ACTIVE',
                   'RESTRICTED','FROZEN','REVOKED']
CAPABILITY_STATUS = ['ACTIVE','EXPIRED','REVOKED','SUSPENDED']
CAPABILITY_TYPE   = ['GRANT','ATTENUATED_GRANT']
EXECUTION_STATUS  = ['NOT_EXECUTED','EXECUTED_AS_AUTHORIZED',
                     'BLOCKED_UNENFORCEABLE','FAILED']
INCIDENT_TYPES  = ['COORDINATION_DETECTED','TRUST_COLLAPSE','ENFORCEMENT_FAILURE',
                   'ASSURANCE_LAPSE','ANOMALOUS_VELOCITY','MANUAL']
INCIDENT_SEVERITIES = ['LOW','MEDIUM','HIGH','CRITICAL']
INCIDENT_STATUSES   = ['OPEN','INVESTIGATING','MITIGATED','FALSE_POSITIVE','RESOLVED']
RECOMMENDED_ACTIONS = ['ALLOW','LIMIT','REVIEW','BLOCK']
OPERATOR_COMMANDS   = ['APPROVE','DENY','LIMIT','FREEZE','UNFREEZE','REVOKE','EXTEND']
ASSURANCE_LEVELS    = ['WORLD_ONLY','WORLD_PLUS_ACTIVE']
DIMENSION_STATES    = ['KNOWN','UNKNOWN','NOT_APPLICABLE']
```

---

# 2. Probes

## `GET /health` — liveness. No auth.
```jsonc
{ "ok": true, "provenance": { /* … */ } | null }
```
**Always `ok: true` while the process runs.** Do not use it to decide if the backend is usable — `provenance` degrades to `null` rather than failing.

## `GET /ready` — readiness. No auth.
`200` when ready, **`503` when not**.
```jsonc
{
  "ready": true,
  "canAuthorize": true,
  "dependencies": [
    { "dependency": "POSTGRES", "up": true,  "degradedBehaviour": null, "detail": "reachable" },
    { "dependency": "REDIS",    "up": false, "degradedBehaviour": "DEGRADE_LOCAL_ONLY",
      "detail": "connect ECONNREFUSED" },
    { "dependency": "TEMPORAL", "up": true,  "degradedBehaviour": null, "detail": "reachable at localhost:7234" }
  ],
  "summary": "ready"
}
```
`degradedBehaviour` ∈ `REFUSE_ALL | HOLD_FOR_REVIEW | REFUSE_ACTION | DEGRADE_TO_UNKNOWN | DEGRADE_LOCAL_ONLY`. **Render it** — "Redis is down" alone is not actionable; "Redis is down → DEGRADE_LOCAL_ONLY" is.

---

# 3. `/v2` — Trust Runtime  `[X-API-Key]`

## 3.1 Actors

### `POST /v2/actors` → **201**
```jsonc
// request
{ "actorType": "WALLET", "displayName": "Alpha", "wallet": { "address": "0x…" } }
```
```jsonc
// response — ActorView
{
  "id": "cmt…", "actorType": "WALLET", "status": "ACTIVE", "displayName": "Alpha",
  "identities": [
    { "kind": "WALLET", "externalId": "0x…", "status": "ACTIVE",
      "source": "api", "verifiedAt": null }
  ],
  "createdAt": "2026-09-13T…", "updatedAt": "2026-09-13T…"
}
```
`409` if the wallet already belongs to an actor. **On 409, look the actor up rather than failing** — `GET` by wallet isn't exposed, so keep the id you got the first time, or create with `wallet` omitted.

### `GET /v2/actors/:id` → ActorView · `404`

---

### `GET /v2/actors/:id/trust` ⚠️ **rate limited, spends Graph quota**

Query: `?fresh=false` → serve the last stored snapshot instead of rebuilding.

```jsonc
// fresh=false  (cheap — use for polling / lists)
{ "actorId": "cmt…", "band": "UNCERTAIN", "snapshotId": "cmt…", "cached": true }
// 404 if no snapshot exists yet — "omit ?fresh=false to build one"
```

```jsonc
// full rebuild (default) — LIVE Graph fetch, can take seconds
{
  "actorId": "cmt…",
  "snapshotId": "cmt…",
  "band": "UNCERTAIN",
  "vector": {
    "behaviorIntegrity":       { "value": 0.82, "state": "KNOWN",  "basis": "…" },
    "coordinationRisk":        { "value": 0.11, "state": "KNOWN",  "basis": "…" },
    "historyStrength":         { "value": null, "state": "UNKNOWN","basis": "no evidence…" },
    "humanAssurance":          { "value": null, "state": "UNKNOWN","basis": "…" },
    "agentReputation":         { "value": null, "state": "NOT_APPLICABLE", "basis": "…" },
    "evidenceFreshness":       { "value": 1,    "state": "KNOWN",  "basis": "…" },
    "investigationConfidence": { "value": null, "state": "UNKNOWN","basis": "…" }
  },
  "drift": { "signals": [ /* … */ ], "peakMagnitude": 0, "hadBaseline": false },
  "evidenceIds": ["cmt…", "…"],
  "engineVersion": "…", "policyVersion": "v2-1.1", "cached": false
}
```

## 3.2 ⚠️ THE TRUST VECTOR — the rule you must not get wrong

Exactly **7 dimensions**, always all 7 present. Each is `{ value, state, basis }`.

| `state` | `value` | Render as |
|---|---|---|
| `KNOWN` | `0`–`1` | the number + bar |
| `UNKNOWN` | **`null`** | **"UNKNOWN"**, `--color-bolt`, dashed — *not* 0, *not* empty |
| `NOT_APPLICABLE` | **`null`** | "N/A", `--color-faint`, no bar |

```ts
// ❌ every one of these is a correctness bug
value ?? 0
value || 0
Math.round((value ?? 0) * 100)
<Bar width={value * 100} />

// ✅
state === 'KNOWN' ? <Bar value={value!} /> : <Unknown state={state} basis={basis} />
```

**`basis` is always populated** — it's the backend's plain-English reason. Show it. On a radar chart, a null dimension must be a **gap in the polygon**, not a point at the origin; a zeroed axis draws a shape claiming a measurement nobody made.

---

### `GET /v2/actors/:id/trust/history`
```jsonc
{
  "actorId": "cmt…",
  "snapshots": [{ "snapshotId":"…","band":"UNCERTAIN","engineVersion":"…",
                  "policyVersion":"v2-1.1","createdAt":"…" }],
  "signals":   [{ "kind":"BEHAVIOR_DRIFT","positive":false,"weight":0.6,
                  "detail":"…","source":"live-trust-mutation","createdAt":"…" }],
  "balance": { /* reported only — never feeds the band */ }
}
```

### `GET /v2/actors/:id/capabilities`
```jsonc
{
  "actorId": "cmt…",
  "assurance": { "hasLiveLease": true, "level": "WORLD_PLUS_ACTIVE", "expiresAt": "…" },
  "capabilities": [{
    "id":"cmt…","capabilityType":"GRANT","actionType":"TRADE",
    "resourceScope":"…","chainScope":11155111,
    "amountLimit":"1000000","frequencyLimit":20,"frequencyWindowSeconds":86400,
    "allowedTargets":[], "status":"ACTIVE",
    "live": true,                          // ← computed: ACTIVE *and* not past expiry
    "expiresAt":"…"|null,"sourceDecisionId":"…"|null,"createdAt":"…"
  }]
}
```
**Use `live`, not `status`, to decide whether a capability is usable.** A capability can be `ACTIVE` and expired.
`assurance.hasLiveLease: false` → `level` and `expiresAt` are both `null`.

### `GET /v2/actors/:id/enforcement`
```jsonc
{
  "actorId": "cmt…",
  "boundaries": [
    { "adapter":"local",   "actionType":"TRADE", "enforceable": true,  "detail":"…" },
    { "adapter":"ens-eac", "actionType":"TRADE", "enforceable": null,  "detail":"chain unreachable: …" }
  ]
}
```
**`enforceable: null` means "could not check" — render UNKNOWN, not a red cross.** §18.2: an unreachable boundary is not a denial and not an approval.

---

## 3.3 Intents & decisions

### `POST /v2/intents` ⚠️ **rate limited, may trigger a live Graph refresh**

**`actorId` XOR `wallet`** — exactly one. Both or neither → `400`.

```jsonc
{
  "wallet": "0x…",              // or "actorId": "cmt…"
  "resourceType": "campaign",
  "resourceId": "airdrop-1",
  "actionType": "TRADE",
  "chainId": 11155111,          // optional
  "targetAddress": "0x…",       // optional
  "amount": "5000000",          // optional, base-unit STRING
  "asset": "USDC",              // optional
  "protocol": "aave-v3",        // optional
  "expiresAt": "2026-09-13T…",  // optional, default +15 min
  "idempotencyKey": "…"         // optional but STRONGLY recommended
}
```

**`201`** new · **`200`** replayed (`replayed: true`).

```jsonc
// IntentView
{
  "intentId":"cmt…","actorId":"cmt…","status":"DECIDED","actionType":"TRADE",
  "resourceType":"campaign","resourceId":"airdrop-1",
  "parametersHash":"…","idempotencyKey":"…",
  "expiresAt":"…","createdAt":"…","receiptId":"cmt…","replayed":false,
  "decision": {
    "decisionId":"cmt…",
    "result":"LIMIT",                     // ALLOW|LIMIT|CHALLENGE|REVIEW|BLOCK
    "reasonCode":"TRADE_LIMITED_UNCERTAIN_TRUST",
    "reasonSummary":"… Trust band: UNCERTAIN.",
    "requiredAssurance": null,
    "policyVersion":"v2-1.1",
    "riskScore": 0.34, "clusterId": null, "confidence":"HIGH",
    "evidenceIds":["…"], "createdAt":"…"
  }
}
```

**`decision` can be `null`** if the intent is still PENDING. Guard it.

**Reading the five results:**
| result | meaning | UI |
|---|---|---|
| `ALLOW` | authorised | green, offer Execute |
| `LIMIT` | authorised **but narrowed** — a capability was still minted | amber; **show requested vs granted** |
| `CHALLENGE` | needs human assurance (World) first | amber; route to verification |
| `REVIEW` | held — could not authorise | bolt; **this is the fail-closed path** |
| `BLOCK` | refused | signal |

`reasonCode: "EVIDENCE_NOT_FRESH"` + `result: "REVIEW"` is the **§27.5 fail-closed gate** — the Graph was unreachable or the wallet has no fresh evidence. It is the system working, not an error.

### `GET /v2/intents/:id` → IntentView · `404`

---

### `POST /v2/intents/:id/execute` — the execution boundary

**No request body.**

- **`200`** executed
- **`409`** refused ← the normal, designed refusal
- **`404`** no such intent

```jsonc
{
  "intentId":"cmt…",
  "status":"EXECUTED_AS_AUTHORIZED",     // or BLOCKED_UNENFORCEABLE | FAILED | NOT_EXECUTED
  "executed": true,
  "reason":"confirmed by local + ens-eac",
  "adapters":["local","ens-eac"],
  "capabilityId":"cmt…"|null,
  "txHash": null,
  "receiptId":"cmt…"|null
}
```

**Branch on `executed`, not on the status code.** A `409` with `BLOCKED_UNENFORCEABLE` means every boundary was consulted and at least one refused — the action genuinely did not happen.

---

## 3.4 Agents

### `POST /v2/agents` → **201**

**`actorId` XOR `wallet`.** `ensLabel` is **opt-in and costs real gas.**

```jsonc
{ "wallet":"0x…", "name":"Alpha", "agentUri":"https://…", // optional
  "configuration":{}, "ensLabel":"alpha" }                // optional; ^[a-z0-9-]{3,63}$
```
```jsonc
{
  "agentId":"cmt…","actorId":"cmt…","name":"Alpha","status":"DRAFT",
  "verification": { "world":"REQUIRED", "activeLiveness":"OPTIONAL" },
  "ens": { "name":"alpha.xander.eth"|null, "minted":true,
           "skipReason":null,           // ENS_DISABLED|NO_OPERATOR_KEY|NO_AGENT_REGISTRY|NO_ENS_NAME
           "txHash":"0x…"|null, "detail":"alpha.xander.eth registered" }
}
```
**A new agent has ZERO capabilities.** Show that — a name is not an authorisation.
`ens.minted: false` with a `skipReason` is **not an error**; the agent works, it just has no on-chain identity.

### `GET /v2/agents?actorId=…` → `{ "agents": [ /* raw Agent rows, ≤100, newest first */ ] }`

Agent row fields: `id, actorId, name, status, agentUri, erc8004AgentId, worldAgentId, ensName, ensTokenId, worldChallengeId, assuranceLeaseId, configurationJson, createdAt, updatedAt`.

### `GET /v2/agents/:id` → agent row **+ `challenges` (last 10) + `ens` read LIVE from chain**
```jsonc
{ …agent, "challenges":[…],
  "ens": { "fqdn":"alpha.xander.eth","registered":true,
           "expiresAt":"…","onChainActions":["CLAIM","API_REQUEST"] } | null }
```
`ens` is `null` if the chain read threw. It is read live on purpose — a divergence between it and the database is what an operator needs to see.

---

### `POST /v2/agents/:id/verify` — establishes assurance + mints capabilities
```jsonc
{ "worldChallengeId":"cmt…", "livenessChallengeId":"cmt…" }  // liveness optional
```
```jsonc
{
  "agentId":"cmt…","status":"ACTIVE",
  "assurance": { "leaseId":"cmt…","level":"WORLD_PLUS_ACTIVE","expiresAt":"…" },
  "capabilityIds":["cmt…","cmt…"],
  "ens": { "mirrored":true,"skipReason":null,"txHash":"0x…","detail":"granted CLAIM, API_REQUEST" }
}
```
Both proofs → `WORLD_PLUS_ACTIVE` (**longer lease**). World only → `WORLD_ONLY` (shorter).
**`409`** if the agent is in a state that cannot transition (e.g. already ACTIVE, or DRAFT→HUMAN_BACKED skipping VERIFYING).

### `POST /v2/agents/:id/freeze` · `/unfreeze` · `/revoke`
```jsonc
{ "reason": "…" }   // required, 1–500 chars
```
```jsonc
// freeze
{ "agentId":"…","status":"FROZEN","capabilitiesSuspended":3,
  "ens": { "revokedOnChain":true,"skipReason":null,"txHash":"0x…","detail":"revoked CLAIM, …" } }
// unfreeze
{ "agentId":"…","status":"ACTIVE" }
// revoke
{ "agentId":"…","status":"REVOKED","ens": { …same shape } }
```
⏱ Freeze/revoke on an ENS agent make a **real Sepolia transaction — 5–30s.** Show real progress.
`ens.revokedOnChain: false` means the **local suspension still happened** and IS the enforcement; the chain lagged. Surface it, don't treat it as total failure.
**`409`** on an illegal transition (e.g. unfreeze with a lapsed assurance lease).

### `POST /v2/agents/:id/erc8004`
```jsonc
{ "agentId": "1" }     // the uint256 registry id, as a STRING
```
```jsonc
{ "agentId":"cmt…",
  "erc8004": { "agentId":"1","owner":"0x…","agentUri":"…"|null,
               "feedbackCount":0,"validationCount":0 },
  "agentReputation": null,                    // ← null when unmeasurable. NEVER a default number.
  "basis":"ERC-8004 agent 1 is registered but has no feedback or validations" }
```
`404` if that id isn't in the configured registry.

---

## 3.5 ⭐ Active liveness (MediaPipe)

### `POST /v2/verification/liveness/start` → **201**
```jsonc
{ "actorId":"cmt…", "agentId":"cmt…",      // agentId optional
  "sessionBinding":"<8–200 chars>" }        // generate once per attempt
```
```jsonc
{
  "challengeId":"cmt…",
  "nonce":"<64 hex>",
  "target": 3,                               // 1–5
  "instruction":"Hold up exactly 3 fingers to the camera.",   // DISPLAY VERBATIM
  "expiresAt":"…"                            // +120 seconds
}
```

### `POST /v2/verification/liveness/complete` → **always 200**
```jsonc
{
  "challengeId":"cmt…",
  "nonce":"<echoed exactly>",
  "sessionBinding":"<BYTE-IDENTICAL to start>",
  "cvVersion":"mediapipe-tasks-vision@1.0.1",   // optional, ≤64 chars
  "frames":[
    { "tMs":0,   "landmarks":[ {"x":0.51,"y":0.88,"z":0.0}, /* …exactly 21… */ ] },
    { "tMs":100, "landmarks":[ /* exactly 21 */ ] }
  ]
}
```
```jsonc
{ "challengeId":"cmt…","passed":true,"reason":"…","failureCode":null }
```

**Hard constraints — a violation is a `400`, not a soft failure:**

| Field | Rule |
|---|---|
| `frames` | **1–600** items |
| `landmarks` | **exactly 21** per frame — `.length(21)`, not "at least" |
| `x`,`y` | MediaPipe's normalised `0–1`. **Do not scale to pixels.** |
| `z` | optional, pass through if present |
| `tMs` | ms from capture start, increasing |
| `sessionBinding` | **byte-identical** to `/start` or it rejects |
| `nonce` | echoed exactly |
| `challengeId` | **single use** — retry = call `/start` again |

**Always HTTP 200.** Branch on `passed`, never the status code — a rejected proof is a valid answer to a valid request.

**Never send imagery.** Landmarks only (spec §28). No frames, no data URLs, no crops.
**Never synthesise landmarks** to help it pass — that defeats the mechanism entirely.
**Start closed, then transition** (fist → N fingers): the server wants to see change, and a held-up photo produces a constant landmark set.

Landmark index order is MediaPipe's and the backend depends on it exactly:
```
0 WRIST | 1-4 THUMB(CMC,MCP,IP,TIP) | 5-8 INDEX(MCP,PIP,DIP,TIP)
9-12 MIDDLE | 13-16 RING | 17-20 PINKY   (each MCP,PIP,DIP,TIP)
```

---

## 3.6 Incidents

### `POST /v2/incidents` → **201**
```jsonc
{ "actorId":"cmt…","clusterId":null,"campaignId":null,
  "type":"COORDINATION_DETECTED","severity":"HIGH",
  "source":"substreams","detail":"shared funder detected",
  "startWorkflow": true }                      // optional — starts the Temporal workflow
```
```jsonc
{ "incident": { /* Incident row */ },
  "workflow": { "started":true,"workflowId":"incident-cmt…","detail":"…" } | null }
```

**Side effects, automatic:**
1. `CRITICAL` → capabilities **REVOKED** · `HIGH` → **SUSPENDED**, *before* any investigation
2. `HIGH`/`CRITICAL` with an actor → **a pending operator action is raised** (`allowed: [APPROVE, LIMIT, FREEZE]`) — this is what makes the phone light up
3. Deduplicated on `(actorId, type)` while OPEN/INVESTIGATING; a **more severe** repeat escalates and re-contains

### `GET /v2/incidents?status=…&actorId=…` → `{ "incidents": [ … ] }` (≤50, newest first)

### `GET /v2/incidents/:id`
```jsonc
{ "incident": { /* row */ },
  "investigation": { /* row or null */ } }
```
Incident row: `id, actorId, clusterId, campaignId, type, severity, status, openedAt, closedAt, rootCause, investigationId, source, detail, mitigation, mitigationReason, updatedAt`.

### `POST /v2/incidents/:id/investigate`
No body.
```jsonc
{ "incidentId":"cmt…","investigationId":"cmt…",
  "counterEvidence": {
    "wallets":["0x…"],
    "findings":[{ "kind":"SHARED_FUNDER_IS_LABELLED",
                  "detail":"Counterparty 0x… is a labelled EXCHANGE (\"Binance 9\", MEDIUM)…",
                  "weight":0.7,"evidenceIds":["…"] }],
    "consideredEvidenceIds":["…"],
    "doubt": 0.7,                    // ← null when there was NO evidence to check
    "summary":"Found 4 reason(s) to doubt coordination…"
  } }
```
`doubt: null` ≠ `doubt: 0`. Null = nothing to check. Zero = checked, found nothing exculpatory.
Finding kinds: `SHARED_FUNDER_IS_LABELLED · ACTIVITY_IS_NOT_SYNCHRONISED · PROTOCOL_USAGE_DIVERGES · INDEPENDENT_PRIOR_HISTORY`.
**`409`** if the incident is already closed.

The `Investigation` row carries the §15.1 structured finding: `hypothesis, supportingEvidenceIds[], contradictingEvidenceIds[], affectedRelationships, confidence, recommendedAction`.

### `POST /v2/incidents/:id/mitigate`
```jsonc
{ "aiRecommendation": "ALLOW" }    // optional; ALLOW|LIMIT|REVIEW|BLOCK
```
```jsonc
{
  "incident": { /* updated row */ },
  "capabilitiesAffected": 2,
  "reconciliation": {
    "action":"BLOCK",
    "aiChangedOutcome": false,
    "aiAttemptedToWiden": true,       // ← the AI tried to loosen it and was IGNORED
    "reason":"investigation recommended ALLOW, which is weaker than the deterministic BLOCK; IGNORED"
  }
}
```
**§15.3: the AI may tighten a decision, never loosen it.** When `aiAttemptedToWiden` is `true`, show it prominently — it is the single best screen for explaining the safety model, and an investigator repeatedly arguing below the floor is itself a signal.

### `POST /v2/incidents/:id/resolve`
```jsonc
{ "status":"FALSE_POSITIVE",          // or RESOLVED
  "rootCause":"shared funder is a labelled exchange",   // REQUIRED, non-blank
  "restore": true }                   // ONLY legal with FALSE_POSITIVE
```
```jsonc
{ "incident": { /* row */ }, "restored": 1 }
```
- Blank `rootCause` → **`400`**. Don't let the form submit empty.
- `restore: true` with `RESOLVED` → **`400`**.
- Closed is **terminal** — reopening → `409`.

### `POST /v2/incidents/:id/finding` — deliver an AI finding to the running workflow
```jsonc
{ "investigationId":"cmt…","recommendedAction":"ALLOW",
  "confidence":0.9,"summary":"…" }
```
```jsonc
{ "signalled": true, "detail": "finding delivered" }
```
`signalled: false` just means no workflow was listening. Not an error.

---

# 4. `/x402` — agent commerce  **[NO AUTH]**

Protocol **v2**. Headers are `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`, each **base64 of JSON**. v1's `X-PAYMENT` is a different, incompatible protocol — do not use it.

## `GET /x402/info`
```jsonc
{
  "x402Version": 2,
  "resource":"http://localhost:3000/x402/risk-report",
  "accepts":[{
    "scheme":"exact","network":"eip155:84532",     // CAIP-2 — Base Sepolia
    "amount":"1000",                               // atomic units = 0.001 USDC
    "asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo":"0x…","maxTimeoutSeconds":300,
    "extra":{ "name":"USDC","version":"2" }        // ← the EIP-712 domain
  }],
  "facilitator": { "supported": true, "detail":"exact on eip155:84532 (v2)" }
}
```

## `GET /x402/risk-report?wallet=0x…`

**Identity:** taken from the **signed authorization** when present; the `X-Wallet` header is only consulted on the unpaid first request.

### Unpaid → **402**
Header `PAYMENT-REQUIRED` = base64 of:
```jsonc
{ "x402Version":2, "error":"PAYMENT-SIGNATURE header is required",
  "resource":{ "url":"…","description":"…","mimeType":"application/json" },
  "accepts":[ /* PaymentRequirements */ ], "extensions":{} }
```
Body (convenience mirror — **the header is the protocol**):
```jsonc
{ "error":"payment_required","x402Version":2,"trustBand":"UNCERTAIN",
  "reasonCode":"X402_ALLOWANCE_NEW","allowanceRemaining":10,"accepts":[…] }
```

### Refused → **403, and NO `PAYMENT-REQUIRED` header**
A 402 invites payment; we do not invite payment from an agent we have refused.
```jsonc
{ "error":"denied","message":"Xander refused this request (REVIEW). No payment is being solicited.",
  "trustBand":"INSUFFICIENT_EVIDENCE","reasonCode":"EVIDENCE_NOT_FRESH","allowanceRemaining":null }
```

### Allowance exhausted → **429** (not 403 — it may succeed later)

### Paid → **200**
Send `PAYMENT-SIGNATURE: <base64 PaymentPayload>`:
```jsonc
{
  "x402Version":2,
  "resource":{ "url":"…" },
  "accepted": { /* the PaymentRequirements you were quoted, unchanged */ },
  "payload": {
    "signature":"0x…",                       // EIP-712 TransferWithAuthorization
    "authorization":{
      "from":"0x…","to":"0x…","value":"1000",
      "validAfter":"1757…","validBefore":"1757…",
      "nonce":"0x<64 hex>"                    // 32 bytes, single use
    }
  },
  "extensions":{}
}
```
Response carries `PAYMENT-RESPONSE` (base64 SettlementResponse) plus:
```jsonc
{ "resource":"…","paidBy":"0x…","transaction":"0x…","network":"eip155:84532",
  "allowanceRemaining":9, "report": { /* the trust report you bought */ } }
```

**Client signing** — EIP-712 domain from the quote:
```ts
domain = { name: extra.name, version: extra.version,
           chainId: 84532, verifyingContract: asset }
types  = { TransferWithAuthorization: [
  {name:'from',type:'address'}, {name:'to',type:'address'},
  {name:'value',type:'uint256'}, {name:'validAfter',type:'uint256'},
  {name:'validBefore',type:'uint256'}, {name:'nonce',type:'bytes32'} ] }
```
Backdate `validAfter` by ~60s for clock skew. `validBefore` = now + `maxTimeoutSeconds`.

**Failure modes:** `402 PAYMENT_INVALID` (mismatched payTo/underpaid/expired/replayed nonce) · `503` facilitator unreachable — **the agent was NOT charged**; settlement happens last.

## `GET /x402/payments/:actorId`
```jsonc
{ "actorId":"…","payments":[{ "id":"…","status":"SETTLED",   // REQUIRED|DENIED|INVALID|VERIFIED|SETTLED|FAILED
    "reasonCode":"…","trustBand":"UNCERTAIN","amount":"1000",
    "network":"eip155:84532","transaction":"0x…"|null,
    "errorReason":null,"createdAt":"…","settledAt":"…"|null }] }
```
**Includes refusals** — that's the point of the ledger.

---

# 5. `/v2/control` — Remote Authority  `[Bearer + X-Device-Id]`

**Every request** needs both:
```
Authorization: Bearer <token>
X-Device-Id: <the same device id used to open the session>
```
Missing either → `401`. Right token, **wrong device** → `401 "device mismatch"`.

## `POST /v2/control/sessions` → **201** — the only unauthenticated control route
```jsonc
{ "externalId":"op@xander.test","secret":"<enrolment secret>",
  "deviceId":"<generate once, persist, ≥8 chars>" }
```
```jsonc
{ "token":"<base64url>","sessionId":"cmt…","expiresAt":"…" }   // ~1 hour
```
**The token is returned once and stored only as a hash.** Persist it client-side or the session is lost.
`401` on bad credentials — **identical message** for wrong secret and unknown operator (deliberate; don't leak the difference in your UI either).

> **Operators are created out-of-band.** There is no enrolment HTTP route — `enrolOperator()` is called from a script/console. Ask the backend for a seeded operator id + secret for the demo.

## `DELETE /v2/control/sessions` → `{ "closed": true }` — token dies immediately.

## `GET /v2/control/agents` → `{ "agents":[{ id,name,status,ensName,actorId,updatedAt }] }` (≤50)

## `GET /v2/control/agents/:id`
```jsonc
{
  "agent": { "id","name","status","ensName","erc8004AgentId" },
  "trust": { "band":"UNCERTAIN","snapshotId":"…","at":"…" } | null,
  "assurance": { "level":"WORLD_PLUS_ACTIVE","expiresAt":"…" } | null,
  "capabilities":[{ "id","actionType","status","amountLimit","expiresAt" }],
  "openIncidents":[{ "id","type","severity","status","openedAt" }]
}
```

## `GET /v2/control/agents/:id/evidence`
```jsonc
{ "agentId":"…","wallets":["0x…"],
  "signals":[{ "kind","positive","weight","detail","source","at" }],
  "evidence":[{ "id","chain","eventType","protocol","counterparty","amount",
                "sourceType","blockNumber","at" }] }   // ≤50, newest first
```

## `GET /v2/control/incidents?status=…` → `{ "incidents":[…] }`
Defaults to `OPEN | INVESTIGATING | MITIGATED`.

## `GET /v2/control/pending-actions` ← **poll this**
```jsonc
{ "actions":[{
  "id":"cmt…","subjectType":"INCIDENT","subjectId":"cmt…",
  "summary":"COORDINATION_DETECTED on Alpha — HIGH. Already contained (RESTRICT). Decide what happens next.",
  "allowed":["APPROVE","LIMIT","FREEZE"],
  "severity":"HIGH",
  "bindingHash":"<64 hex>",        // ← MUST be echoed back with the decision
  "requiresStepUp": false,
  "expiresAt":"…"                  // ~15 min
}] }
```
**Reading this list expires stale actions server-side** — the list and the database stay in agreement.
There is **no push channel.** Poll every 3–10s.

## `POST /v2/control/pending-actions` → **201** — raise one manually
```jsonc
{ "subjectType":"AGENT",          // INTENT|INCIDENT|AGENT
  "subjectId":"cmt…","summary":"…","allowed":["APPROVE","DENY","LIMIT"],
  "actorId":"cmt…","agentId":"cmt…","incidentId":null,"intentId":null,
  "amount":"5000","severity":"HIGH","ttlSeconds":900 }
```

---

## 5.1 ⚠️ Decisions — three things must be right

`POST /v2/control/actions/:id/approve` · `/deny` · `/limit`

```jsonc
{ "bindingHash":"<64 hex, copied from the pending action>",
  "nonce":"<fresh, single-use, ≥16 chars — crypto.randomUUID()>",
  "reason":"…",                    // optional (require it in UI for deny/limit)
  "limitAmount":"500",             // REQUIRED on /limit
  "stepUpProofId":"cmt…" }         // required if requiresStepUp
```
```jsonc
{ "actionId":"cmt…","command":"APPROVE","applied":true,
  "workflowSignalled":true,"detail":"APPROVE applied" }
```

**The three rules:**
1. **`bindingHash` must match** the action's stored hash → else `409 "action binding mismatch"`. It hashes the action's immutable facts, so a decision captured for a $10 action cannot be replayed against a $10,000 one.
2. **`nonce` is single-use globally** → reuse gives `409 "already been submitted"`. Generate fresh per attempt. **Never retry with the same nonce.**
3. **The command must be in `allowed`** → else `400`.

Other refusals: `409` already decided · `409` expired (*expiry is a refusal, not an approval*) · `403` outside the operator's scope · `403` step-up required.

`workflowSignalled: false` is normal — most actions have no running workflow.

## `POST /v2/control/agents/:id/freeze` · `/revoke`
```jsonc
{ "nonce":"<fresh>","reason":"…","stepUpProofId":"…" }   // no bindingHash — created internally
```
Same response shape. ⏱ Real Sepolia transaction on an ENS agent.

## `GET /v2/control/audit?mine=true`
```jsonc
{ "entries":[{ "id","operatorId","sessionId","deviceId","action","subject",
               "outcome":"DENIED","reason","nonce","ip","createdAt" }] }   // ≤100
```
**Refusals are recorded too.**

---

# 6. V1 Claim Gate — the World flow  `[X-API-Key]`

Use these for World Selfie Check. **This exact chain is proven against a real phone.**

## `POST /screen-claim` → **200** decided · **202 CHALLENGE**
```jsonc
{ "wallet":"0x…","campaignId":"airdrop-1" }
```
```jsonc
{ "claimId":"cmt…","decision":"CHALLENGE",       // ALLOW|CHALLENGE|BLOCK|PENDING_REVIEW
  "clusterId":null,"riskScore":0.41,
  "requiredAssurance":"WORLD_ID","evidenceReceiptId":"cmt…",
  "verificationChallengeId":"cmt…",
  "idkit": { "app_id":"app_…","rp_id":"…","action":"claim-…",
             "preset":"…","signal":"0x…","allow_legacy_proofs":true },   // only on CHALLENGE
  "reason":"…","cached":false }
```

## `POST /world/rp-signature`
```jsonc
{ "action":"<the action string from idkit.action>" }
```
```jsonc
{ "sig":"0x…","nonce":"…","created_at":1757…, "expires_at":1757… }
```
`503 world_unconfigured` if the signing key is missing.

## Client step — build the request and poll
```ts
import { IDKit, selfieCheckLegacy } from '@worldcoin/idkit-core'
// build with idkit config + the rp-signature, render the returned URL as a QR,
// then poll the World bridge for the proof.
```
Render the URL with `qrcode`. **Use `@worldcoin/idkit-core` + `qrcode`, not the React widget** — the core SDK is what was tested end to end.

## `POST /world/verify` → **200 PASSED** · **400 FAILED** · **503 RETRYABLE**
```jsonc
{ "claimId":"cmt…","idkitResponse": { /* the IDKit result, FORWARDED UNMODIFIED */ },
  "rp_id":"…" }   // optional
```
```jsonc
{ "status":"PASSED","challengeId":"cmt…","reason":"…" }
```
⚠️ **Do not remap any field of `idkitResponse`.** Field remapping is the documented way this call breaks. Forward the object byte-for-byte.
**`503` = World unreachable, not a failed verification.** Offer retry; never render it as "you failed".

## `POST /claim/finalize`
```jsonc
{ "claimId":"cmt…" }
```
```jsonc
{ "claimId":"…","decision":"ALLOW","evidenceReceiptId":"…","worldChallengeId":"…","reason":"…" }
```

## Read-only V1 (useful for the evidence explorer)
| Route | Returns |
|---|---|
| `GET /wallets/:address/risk` | risk + cluster + features for a wallet |
| `GET /clusters/:id` · `/clusters/:id/evidence` | cluster members · its evidence rows |
| `GET /receipts/:id` | the evidence receipt |
| `GET /campaigns/:id` | campaign summary |
| `POST /investigations` `{clusterId}` · `GET /investigations/:id` | MCP investigation |

---

# 7. Wiring the demo, in order

| # | Screen | Calls |
|---|---|---|
| 0 | Evidence | `GET /wallets/:a/risk` → `POST /v2/actors` → `GET /v2/actors/:id/trust` |
| 1 | Create agent | `POST /v2/agents` (with `ensLabel`) |
| 2 | World | `POST /screen-claim` → `POST /world/rp-signature` → IDKit → `POST /world/verify` |
| 3 | Liveness | `POST /v2/verification/liveness/start` → `/complete` |
| 4 | Go live | `POST /v2/agents/:id/verify` → `GET /v2/agents/:id` |
| 5 | Trust | `GET /v2/actors/:id/trust`, `/capabilities`, `/enforcement` |
| 6 | Act | `POST /v2/intents` → `POST /v2/intents/:id/execute` |
| 7 | Buy | `GET /x402/info` → `GET /x402/risk-report` (402 → sign → 200) |
| 8 | Incident | `POST /v2/incidents` `{severity:"HIGH", startWorkflow:true}` → `/investigate` → `/mitigate` `{aiRecommendation:"ALLOW"}` |
| 9 | Phone | `POST /v2/control/sessions` → poll `/pending-actions` → `/actions/:id/approve\|limit` or `/agents/:id/freeze` |

**Step 8 auto-raises the pending action for step 9.** No manual POST needed.

---

# 8. Environment

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
# The API key is a DEV convenience. Never ship it in a public bundle —
# proxy through a Next route handler for anything real.
```

**Chain explorers** — pick by the chain field, never hardcode:
| Chain | id | Explorer |
|---|---|---|
| Sepolia (ENS, ERC-8004) | `11155111` | `sepolia.etherscan.io` |
| Base Sepolia (x402) | `84532` / `eip155:84532` | `sepolia.basescan.org` |

**Local stack:** Postgres `5433` · Redis `6380` · Temporal `7234` · Temporal UI `8233`.
The **Temporal worker must be running** (`npm run worker`) for incident workflows and operator signals.

---

# 9. Known gaps — build around these

| # | Gap | Workaround |
|---|---|---|
| 1 | No aggregate-stats endpoint | count client-side from the lists |
| 2 | No policy-rules endpoint | `/console/policy` ships static, or ask backend |
| 3 | **No push channel** | poll `/pending-actions` every 3–10s |
| 4 | No enrolment route for operators | seeded out-of-band; ask for id + secret |
| 5 | No pagination anywhere | lists cap at 50 (100 for audit/agents) |
| 6 | No `GET /v2/actors?wallet=` | keep the actorId from `POST /v2/actors`; 409 means it exists |
| 7 | Parked workflows don't raise pending actions | only incidents do — sufficient for the demo |

---

# 10. Five mistakes that will cost you a day

1. **Sending `X-API-Key` to `/v2/control/*`** → 401, looks like a broken token. It's rejected by design.
2. **Rendering `value: null` as `0`.** A null dimension is UNKNOWN. Zeroing it invents a measurement.
3. **Treating `409` from `/execute` as an error.** It's the designed refusal — the whole point of the phase.
4. **Reusing a control-plane `nonce` on retry** → 409 forever. Fresh nonce per attempt.
5. **Sending images to the liveness endpoint.** Landmarks only — 21 per frame, normalised 0–1, never scaled.
