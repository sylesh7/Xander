# SYBIL V2 — End-to-End Backend Build Specification

**Working name:** Xander  
**Document:** Backend V2 implementation blueprint  
**Status:** Build-ready architecture  
**Audience:** Backend / protocol / security engineers and coding agents  
**Purpose:** Extend the existing Sybil backend into a durable trust-and-authorization runtime for humans, wallets, and AI agents without rewriting working V1 components.

---

## 0. Executive decision

V2 is **not** a rewrite and is not a second Sybil detector.

V2 keeps the existing Graph-native evidence/risk engine and World verification path, then adds a control layer above them:

```text
Actor
  -> Action Intent
  -> Evidence / Trust Context
  -> Policy Evaluation
  -> Capability
  -> Allow / Limit / Challenge / Block
  -> Execution
  -> Continuous Monitoring
  -> Trust Update
  -> Capability Update
```

The backend must therefore become a **Trust Runtime** rather than a claim-only scoring API.

### V2 north-star

> Xander continuously evaluates who or what is acting, what evidence exists about that actor, and what capability that actor should have for a specific action.

### V2 primary product surfaces

1. **Claim Guard** — existing Sybil/claim protection remains the first vertical.
2. **Agent Guard** — create and operate human-backed AI agents with bounded permissions.
3. **Action Guard** — evaluate any high-value action, not only claims.
4. **Remote Authority** — human control plane for approvals, limits, freeze and revoke.
5. **Investigator** — Graph-backed AI investigation for anomalies.

---

# 1. V1 baseline — what is already real

The repository audit compiled on 2026-09-11 is the source of truth for V1. It reports that all Evidence & Risk Engine phases 1–12 are implemented, phases 13–24 of the Decision/Escalation/API track are implemented, and only the joint Phase 25 validation remains open. The audit explicitly checked source tree, tests and database rather than relying on earlier documentation. fileciteturn0file0L3-L5 fileciteturn0file0L42-L59 fileciteturn0file0L68-L82

## 1.1 Reuse, do not rewrite

| Existing component | V2 action |
|---|---|
| Graph Token API client | Keep |
| Standardized Subgraphs integration | Keep and expand |
| Evidence normalizer/repository | Keep |
| Behavior graph + Union-Find clustering | Keep and generalize from wallets to actors |
| Five risk features | Keep |
| Median/MAD baseline | Keep |
| Substreams Rust module | Keep and make trust/capability invalidation a first-class output |
| Freshness/provenance | Keep; expose in Trust Context |
| Redis risk cache | Keep for hot state |
| BullMQ | Keep for short background jobs that do not need durable workflows |
| Subgraph MCP | Keep |
| AI investigation agent | Keep; move it behind explicit investigation workflows |
| World RP signing | Keep |
| World backend verification | Keep |
| Wallet/claim binding | Keep and generalize to actor/action binding |
| Replay protection | Keep |
| Policy engine | Keep as policy abstraction; optionally place Cedar behind the same interface later |
| Evidence Receipt | Keep and extend to Action Receipt |
| Claim Gate API | Keep as compatibility surface; add `/v2/actions/*` and `/v2/agents/*` |
| PostgreSQL / Prisma | Keep |
| Existing frontend test tool | Keep as verification harness until V2 product UI is ready |

The V1 audit confirms the Graph and World integrations are real, including a real World phone proof and a real end-to-end claim from challenge through verification to `ALLOW`. fileciteturn0file0L198-L211

## 1.2 Existing V1 risk model

The current model has five features:

- `FUNDING_CORRELATION`
- `TIMING_CORRELATION`
- `WALLET_AGE_SIMILARITY`
- `SHARED_COUNTERPARTY`
- `PROTOCOL_BEHAVIOR_SIMILARITY`

The weights are configurable seed data; the audit explicitly notes the model is a **demo policy, not a validated production model**. The current maximum score is 0.85 because 0.15 is reserved rather than pretending the score is normalized to 1.0. fileciteturn0file0L61-L64

V2 must preserve this honesty. It must not relabel heuristic scores as cryptographic proof or ML validation.

---

# 2. V2 architecture

```text
                              XANDER TRUST RUNTIME

       Human ─────┐
       Wallet ────┼────> ACTOR REGISTRY
       Agent ─────┘             │
                                ▼
                         ACTION / INTENT
                                │
                                ▼
                       TRUST CONTEXT BUILDER
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
          ▼                     ▼                     ▼
      THE GRAPH                WORLD              EXTERNAL
          │                     │                 EVIDENCE
     Token API              Selfie Check             │
     Standardized           AgentKit               ERC-8004
     Subgraphs              AgentBook              EAS
     Substreams
     Subgraph MCP
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                ▼
                           ACTOR GRAPH
                                │
                                ▼
                           TRUST VECTOR
                                │
                                ▼
                         AI INVESTIGATOR
                                │
                                ▼
                         POLICY RUNTIME
                                │
                                ▼
                         CAPABILITY ENGINE
                                │
                 ┌──────────────┼──────────────┐
                 ▼              ▼              ▼
              ALLOW           LIMIT        CHALLENGE
                 │              │              │
                 │              │       World / Active CV
                 │              │              │
                 └──────────────┼──────────────┘
                                ▼
                           ENFORCEMENT
                    ┌───────────┼────────────┐
                    ▼           ▼            ▼
                 x402        ERC-7715      Safe/OZ
                    │           │            │
                    └───────────┼────────────┘
                                ▼
                              ACTION
                                │
                                ▼
                           SUBSTREAMS
                                │
                                ▼
                         TRUST / DRIFT CHANGE
                                │
                             Temporal
                                │
                  ┌─────────────┴────────────┐
                  ▼                          ▼
              CONTINUE                 INTERRUPT
                                             │
                                             ▼
                                       HUMAN COMMAND
                                             │
                                             ▼
                                           MOBILE
```

---

# 3. Architectural invariants

These are non-negotiable.

## 3.1 AI is not the final authority

AI can investigate and propose findings. Deterministic evidence, policy and explicit authorization rules make the security decision.

## 3.2 Absence of history is not low risk

A new wallet is represented as `INSUFFICIENT_EVIDENCE`, not as `SAFE`.

## 3.3 World proof is not ownership proof of arbitrary wallets

World evidence is modeled as an assurance signal. Do not claim that a Selfie Check makes a wallet universally legitimate.

## 3.4 Wallet, human and agent are distinct entities

The backend must not collapse:

```text
wallet != human
wallet != agent
agent != human
unique wallet != unique human
risk score != proof of identity
```

## 3.5 Permissions are scoped to actions

Trust must be evaluated relative to the action and resource. A trusted actor for a $100 claim is not automatically trusted for a $100,000 treasury transfer.

## 3.6 Every security decision must have evidence lineage

Every decision stores the relevant evidence IDs, rules/policy version, trust snapshot and resulting capability/decision.

## 3.7 No raw biometric media in Xander storage

Active CV challenges should produce challenge outcome metadata, not permanent raw video, unless a separately justified retention policy is introduced later.

## 3.8 V2 is additive

Do not rewrite the proven Graph/World integrations merely to introduce the new trust runtime.

---

# 4. External technology decisions

## 4.1 The Graph — mandatory core

The Graph remains the evidence substrate. Current Graph documentation positions Subgraphs for structured indexed data, Substreams for real-time streaming and high-throughput processing, and MCP as an AI-access layer. The Graph also describes Token API as a standardized token-data service backed by Substreams. citeturn640782search0turn640782search1turn640782search3turn640782search5

V2 responsibilities:

| Graph product | Xander responsibility |
|---|---|
| Token API | Wallet/token reconnaissance |
| Standardized Subgraphs | Cross-protocol behavioral semantics |
| Substreams | Live actor/trust changes |
| Subgraph MCP | AI investigation |
| Agent/identity-related indexed data | Agent trust inputs where available |

The Graph currently describes standardized indexed data as a way to query comparable entities across protocols and has demonstrated standardized lending schemas queried across many protocols through a single pattern. citeturn640782search11

## 4.2 World — mandatory core

World's current stack includes Selfie Check and an agent-oriented stack around AgentKit/AgentBook. Use Selfie Check as an assurance signal and AgentKit/AgentBook for human-backed agent onboarding where supported by the current account/application configuration.

V2 must validate the current World SDK/API contract before implementation because the official API surface is version-sensitive.

## 4.3 ERC-8004 — mandatory agent identity layer

ERC-8004 defines Identity, Reputation and Validation registries for agents and explicitly describes pluggable, tiered trust proportional to value at risk. citeturn249629search4

Xander uses ERC-8004 as an external agent identity/reputation/validation source; Xander does not replace those registries.

## 4.4 ERC-7715 — preferred scoped-permission direction

ERC-7715 defines wallet-level execution-permission requests, including scoped permission data, rules and revocation. It requires ERC-4337 and is designed for transactions executed on a user's behalf under wallet-granted permissions. citeturn249629search2

V2 should use this where a compatible wallet supports it. The backend must have a fallback authorization adapter for environments that do not support ERC-7715.

## 4.5 ERC-4337 — execution/account substrate

ERC-4337 provides smart accounts and `UserOperation`-based execution, with programmable account validation and optional paymasters. citeturn249629search0

Use it when needed for agent-controlled accounts or bounded execution; do not migrate every account in the product simply to say “we use account abstraction.”

## 4.6 x402 — agent commerce / paid services

The Graph's current hackathon resources identify x402 as a pay-per-query mechanism over HTTP, and the broader ecosystem uses x402 for agent/service payments. citeturn640782search2

Xander uses x402 as an **authorization target**:

```text
agent -> x402 request -> Xander trust/policy -> permit/limit/deny -> service
```

## 4.7 Safe / OpenZeppelin — enforcement

Choose one concrete enforcement path first. Do not implement both completely during the first V2 iteration.

- **Safe**: use Modules/Guards for transaction-level agent/treasury restrictions where the Safe integration is the natural owner of funds.
- **OpenZeppelin AccessManager**: use for role/selector-based authorization when the application owns the contract permission model.

## 4.8 EAS — portable external evidence

Use EAS as a lightweight attestation adapter, not as the primary database. A future version can publish Xander assessments or consume external attestations.

## 4.9 Temporal — workflow runtime

Temporal should own workflows that may pause, wait for humans, retry external calls, survive process restarts, or change state because of live events.

Do not move every short synchronous API call to Temporal.

## 4.10 Cedar — policy language candidate

Cedar models authorization around principal/action/resource/context (PARC) and is designed for explicit policy evaluation. citeturn249629search1turn249629search5

Use it only if it cleanly replaces or strengthens the existing policy engine. It must sit behind an internal `PolicyEvaluator` interface so the rest of Xander is not coupled to Cedar.

---

# 5. V2 domain model

The V2 backend centers on these entities.

```text
Tenant
Campaign / Application
Actor
ActorIdentity
Wallet
Agent
EvidenceEvent
ActorRelationship
Cluster
TrustSignal
TrustSnapshot
Policy
Capability
Intent
AuthorizationDecision
Workflow
VerificationSession
Attestation
Investigation
Incident
ActionReceipt
```

## 5.1 Actor

`Actor` is the logical entity making or controlling actions.

Required fields:

```text
id
actorType: HUMAN | WALLET | AGENT | ORGANIZATION
status
createdAt
updatedAt
```

Do not store a raw statement such as “actor == person X”.

## 5.2 ActorIdentity

Maps an actor to evidence sources:

```text
id
actorId
kind: WALLET | WORLD | ERC8004 | EAS | OTHER
externalId
status
verifiedAt
source
metadataJson
```

## 5.3 Wallet

```text
id
address
chainId
actorId nullable
firstSeenAt
lastSeenAt
```

One actor may have multiple wallets.

## 5.4 Agent

```text
id
actorId
name
status
agentUri nullable
erc8004AgentId nullable
worldAgentId nullable
configurationJson
createdAt
updatedAt
```

## 5.5 ActorRelationship

Represents evidence-backed relationships:

```text
id
fromActorId / fromWalletId
relationType
 toActorId / toWalletId
weight
confidence
sourceEvidenceIds
firstObservedAt
lastObservedAt
```

Supported relationship types initially:

```text
FUNDED_BY
SHARED_COUNTERPARTY
TEMPORALLY_CORRELATED
BEHAVIOR_SIMILAR
SAME_PROTOCOL_PATH
AGENT_BACKED_BY
DELEGATES_TO
```

## 5.6 TrustSnapshot

```text
id
actorId
campaignId nullable
behaviorIntegrity
coordinationRisk
historyStrength
humanAssurance
agentReputation
evidenceFreshness
investigationConfidence
overallBand
engineVersion
policyVersion
createdAt
```

The existing V1 risk score remains available as one input, not the entire trust model.

## 5.7 Intent

Represents the requested action before authorization:

```text
id
actorId
resourceType
resourceId
actionType
chainId nullable
targetAddress nullable
amount nullable
asset nullable
protocol nullable
parametersHash
expiresAt
idempotencyKey
status
createdAt
```

Examples:

```text
CLAIM
VOTE
MINT
TRADE
BORROW
TRANSFER
API_REQUEST
X402_PAYMENT
AGENT_DELEGATION
```

## 5.8 Capability

```text
id
actorId
capabilityType
actionType
resourceScope
chainScope nullable
amountLimit nullable
frequencyLimit nullable
allowedTargets nullable
expiresAt nullable
status
sourceDecisionId
createdAt
```

Examples:

```text
TRADE <= 2000 USDC / day
CLAIM <= 100 USDC
API_CALL <= 500 / hour
BORROW = DENY
```

## 5.9 AuthorizationDecision

```text
id
intentId
trustSnapshotId
policyId
result: ALLOW | LIMIT | CHALLENGE | REVIEW | BLOCK
reasonCode
reasonSummary
evidenceIds
requiredAssurance
capabilityId nullable
workflowId nullable
createdAt
```

## 5.10 ActionReceipt

The existing Evidence Receipt pattern is extended so an action can be reconstructed without re-running external queries.

```text
id
intentId
decisionId
actorId
policyVersion
trustSnapshotId
evidenceSnapshotHash
decisionPayloadHash
executionStatus
executionTxHash nullable
createdAt
```

---

# 6. Trust model

Do not immediately replace the V1 risk engine with ML.

V2 starts with a deterministic multi-dimensional vector.

```text
trustContext = {
  behaviorIntegrity,
  coordinationRisk,
  historyStrength,
  humanAssurance,
  agentReputation,
  evidenceFreshness,
  investigationConfidence
}
```

## 6.1 Cold-start handling

A new wallet can have:

```text
historyStrength = NONE
behaviorIntegrity = UNKNOWN
coordinationRisk = UNKNOWN
```

This must not be mapped to `LOW_RISK`.

Policy decides what assurance is needed for each requested action.

Example:

```text
CLAIM $100
    -> World assurance + active liveness

BORROW $50,000
    -> insufficient trust -> deny or manual review

VOTE
    -> uniqueness/human assurance according to policy
```

## 6.2 Trust bands

Recommended initial bands:

```text
VERIFIED_LOW
ESTABLISHED_LOW
UNCERTAIN
HIGH_RISK
CRITICAL
```

`UNKNOWN` is a trust/evidence state, not a risk score.

## 6.3 Behavior drift

For established actors, compare current behavior against their historical baseline.

Initial drift signals:

- new counterparty
- unusual amount
- new protocol category
- new timing regime
- behavior sequence deviation
- sudden wallet-cluster expansion

Behavior drift is a signal, not an automatic proof of abuse.

---

# 7. Capability system

This is the core V2 innovation.

The backend evaluates:

```text
Can actor A perform action B on resource C under context D?
```

Cedar is a possible policy implementation because this maps directly to its principal/action/resource/context model. citeturn249629search1

## 7.1 Capability outcomes

```text
ALLOW
LIMIT
CHALLENGE
REVIEW
BLOCK
```

`LIMIT` is essential. The system should be able to reduce a capability rather than merely approve/reject.

## 7.2 Capability attenuation

Example:

```text
requested: TRANSFER 5000 USDC
policy result: LIMIT
allowed: 500 USDC
```

If ERC-7715 is supported, the granted permission should be scoped to the approved bounds. ERC-7715 explicitly allows permission data/rules and emphasizes limited scope and expiration. citeturn249629search2

## 7.3 Capability expiry

Every high-value capability should be time-bound where practical.

Examples:

```text
$2,000 trading authority -> 24 hours
one-time treasury transfer -> single execution
agent emergency override -> 10 minutes
```

---

# 8. Intent authorization flow

```text
POST /v2/intents
        │
        ▼
validate intent
        │
        ▼
resolve actor
        │
        ▼
load cached trust state
        │
        ▼
refresh stale evidence if required
        │
        ▼
Graph evidence
        │
        ▼
trust context
        │
        ▼
policy evaluation
        │
  ┌─────┼──────────────┐
  ▼     ▼              ▼
ALLOW LIMIT         CHALLENGE
  │     │              │
  │     │              ▼
  │     │        assurance workflow
  │     │              │
  │     │        World / active CV
  │     │              │
  │     └──────────────┘
  │                    │
  └──────────┬─────────┘
             ▼
        capability
             │
             ▼
         enforcement
             │
             ▼
        action receipt
```

---

# 9. World assurance flow

World is an assurance provider, not the whole trust model.

## 9.1 Human-backed agent creation

```text
POST /v2/agents
        ↓
create pending agent
        ↓
World AgentKit flow
        ↓
AgentBook / World-side resolution
        ↓
store World reference
        ↓
ERC-8004 registration/reference
        ↓
active-liveness challenge
        ↓
agent status = HUMAN_BACKED
        ↓
initial capability envelope
```

The current World AgentKit direction is specifically intended for human-backed agents, authorization, trust, continuity and commerce; exact SDK/API calls must be checked against the currently installed World package before coding.

## 9.2 Step-up verification

Use step-up only when policy requires it.

```text
Challenge
   │
   ├── World Selfie Check
   │
   └── Xander Active Challenge
          ├── hand gesture
          ├── head movement
          └── random challenge nonce
```

The active challenge produces:

```text
challengeId
challengeType
nonce
startedAt
completedAt
result
signalMetadata
```

No raw camera media is required by the backend.

---

# 10. Active liveness subsystem

This is **not** a deepfake detector.

The backend issues a fresh challenge, and the frontend/local CV verifier returns a signed/session-bound result.

## 10.1 Challenge protocol

```text
Backend creates:
challengeId
nonce
challengeType
expiresAt
sessionBinding
```

Frontend performs local CV.

Frontend returns:

```text
challengeId
nonce
result
clientTimestamp
sessionBinding
cvVersion
```

Backend verifies:

- nonce matches
- challenge not expired
- challenge not already consumed
- session binding matches
- result is from the expected client flow

For additional spoof-resistance, an experimental anti-spoof model may be evaluated separately, but it must not be marketed as authoritative deepfake detection.

---

# 11. Agent subsystem

## 11.1 Agent lifecycle

```text
DRAFT
  ↓
VERIFYING
  ↓
HUMAN_BACKED
  ↓
ACTIVE
  ↓
RESTRICTED
  ↓
FROZEN
  ↓
REVOKED
```

## 11.2 Create agent API

```http
POST /v2/agents
```

Request:

```json
{
  "name": "Alpha",
  "wallet": {
    "address": "0x...",
    "chainId": 8453
  },
  "requestedCapabilities": [
    {
      "action": "TRADE",
      "maxAmount": "2000",
      "asset": "USDC",
      "period": "24h"
    }
  ]
}
```

Response:

```json
{
  "agentId": "agt_...",
  "status": "VERIFYING",
  "verification": {
    "world": "REQUIRED",
    "activeLiveness": "REQUIRED"
  }
}
```

## 11.3 Agent action API

```http
POST /v2/agents/:agentId/intents
```

This creates an Intent and enters the normal trust/policy path.

## 11.4 Agent freeze API

```http
POST /v2/agents/:agentId/freeze
POST /v2/agents/:agentId/unfreeze
POST /v2/agents/:agentId/revoke
```

All require authenticated operator authorization and create audit events.

---

# 12. Graph actor-intelligence layer

The existing V1 behavior graph remains the starting point.

V2 adds actor-level relationships.

## 12.1 Evidence sources

Primary:

```text
Token API
Standardized Subgraphs
Substreams
Subgraph MCP
ERC-8004 indexed data where available
```

The Graph itself describes Subgraphs as open/composable APIs, Substreams as streaming infrastructure, and MCP as a natural-language/agent interface for querying indexed data. citeturn640782search0turn640782search3turn640782search5

## 12.2 Actor relationship pipeline

```text
raw blockchain evidence
        ↓
normalized event
        ↓
wallet behavior features
        ↓
wallet relationships
        ↓
actor relationships
        ↓
cluster
        ↓
trust context
```

## 12.3 Known-funder registry

V2 must implement the missing V1 README promise:

```text
KnownFunderAddress
------------------
address
chainId
label
category
source
confidence
validFrom
validTo nullable
```

Initial categories:

```text
EXCHANGE
BRIDGE
FAUCET
PROTOCOL_TREASURY
KNOWN_DISTRIBUTOR
OTHER
```

Funding correlation must down-weight or contextualize a known benign/operational funder rather than treating all shared funders equally.

The current repository audit explicitly confirms this registry does not exist today, despite being claimed by the README. fileciteturn0file0L140-L150

---

# 13. Substreams live trust updates

Existing Substreams and invalidation infrastructure should be extended.

## 13.1 New event categories

```text
ACTOR_ACTIVITY
NEW_COUNTERPARTY
FUNDING_RELATIONSHIP
CLUSTER_MUTATION
BEHAVIOR_DRIFT
AGENT_ACTION
CAPABILITY_RELEVANT_EVENT
```

## 13.2 Processing flow

```text
Substreams
  ↓
Node bridge
  ↓
normalized live event
  ↓
actor graph update
  ↓
trust cache invalidation
  ↓
Temporal signal when a durable workflow is active
  ↓
policy re-evaluation
  ↓
capability update
```

The Graph describes Substreams as real-time streaming infrastructure with cursor-managed processing and database/application sinks, which matches this responsibility. citeturn640782search3

---

# 14. Temporal workflow layer

Temporal is for **durable state**, not for basic CRUD.

## 14.1 Workflows that belong in Temporal

### High-value authorization workflow

```text
START
 ↓
load trust
 ↓
policy
 ↓
challenge required
 ↓
request World
 ↓
WAIT
 ↓
request active liveness
 ↓
WAIT
 ↓
request human approval
 ↓
WAIT
 ↓
re-evaluate policy
 ↓
grant capability
 ↓
execute
 ↓
wait settlement
 ↓
record receipt
 ↓
END
```

### Agent incident workflow

```text
ANOMALY
 ↓
freeze financial capability
 ↓
launch investigation
 ↓
collect evidence
 ↓
wait AI investigation
 ↓
policy decision
 ↓
RESTRICT / RESTORE / REVOKE
 ↓
notify operator
```

### Capability lease workflow

```text
grant capability
 ↓
wait until expiry
 ↓
re-check trust
 ↓
renew / attenuate / revoke
```

## 14.2 Temporal signals

Mobile actions map to durable workflow signals/updates:

```text
APPROVE
DENY
LIMIT
FREEZE
UNFREEZE
REVOKE
EXTEND
```

This is the clean mechanism behind Remote Authority.

---

# 15. AI investigator V2

Existing AI investigator is retained.

## 15.1 New responsibility

Input:

```text
incidentId
actorId
changedTrustSignals
currentTrustSnapshot
```

Investigator must return:

```text
hypothesis
supportingEvidenceIds
contradictingEvidenceIds
affectedRelationships
confidence
recommendedAction
```

## 15.2 Required investigation sequence

```text
1. discover relevant Graph data
2. inspect schema/deployment
3. query supporting evidence
4. query counter-evidence
5. compare prior behavior
6. identify cluster relationships
7. inspect agent/reputation evidence if relevant
8. produce structured finding
```

The Graph's MCP supports search/inspection/query patterns intended for AI access to indexed blockchain data. citeturn640782search5turn640782search11

## 15.3 AI security rule

The AI may recommend:

```text
ALLOW
LIMIT
REVIEW
BLOCK
```

but the recommendation is passed back into deterministic policy evaluation. It is not itself the authorization authority.

---

# 16. ERC-8004 integration

ERC-8004 has three relevant registries: Identity, Reputation and Validation. citeturn249629search4

## 16.1 Minimum V2 integration

Store references:

```text
registry address
chainId
agentId
agentURI
reputation sources
validation references
lastFetchedAt
```

Do not mirror the full registry state into every actor row.

## 16.2 Trust integration

ERC-8004 inputs become trust signals:

```text
agent identity valid
reputation summary
validation status
```

They influence policy but do not become the sole basis for authorization.

---

# 17. x402 integration

V2 should implement one concrete paid-agent flow.

```text
Agent
 ↓
request Xander-protected resource
 ↓
x402 payment challenge
 ↓
Xander trust/policy
 ↓
ALLOW / LIMIT / DENY
 ↓
service response
 ↓
record ActionReceipt
```

Example policy:

```text
new agent            -> 10 requests/day
human-backed agent   -> 500 requests/hour
trusted agent        -> 5000 requests/hour
anomalous agent      -> 0
```

This gives Xander an immediate use case beyond airdrops.

---

# 18. Scoped authorization / enforcement

## 18.1 Authorization adapter interface

Create an internal abstraction:

```ts
interface EnforcementAdapter {
  grant(capability: Capability): Promise<GrantResult>;
  revoke(capabilityId: string): Promise<RevokeResult>;
  attenuate(capabilityId: string, limits: CapabilityLimits): Promise<GrantResult>;
  inspect(capabilityId: string): Promise<CapabilityState>;
}
```

Implement adapters in this order:

```text
1. internal/mock-free local policy adapter for development
2. ERC-7715-compatible wallet permission adapter where supported
3. Safe adapter OR OpenZeppelin adapter for one concrete onchain enforcement demo
```

Do not couple the policy engine directly to Safe or ERC-7715.

## 18.2 Enforcement failure rule

If Xander cannot prove that a capability was successfully granted/restricted, the action must not be reported as `EXECUTED_AS_AUTHORIZED`.

---

# 19. Mobile Remote Authority backend

The mobile app is not a remote desktop client.

It is a **human authority plane**.

## 19.1 Endpoints

```http
GET  /v2/control/agents
GET  /v2/control/agents/:id
GET  /v2/control/incidents
GET  /v2/control/pending-actions
POST /v2/control/actions/:id/approve
POST /v2/control/actions/:id/deny
POST /v2/control/actions/:id/limit
POST /v2/control/agents/:id/freeze
POST /v2/control/agents/:id/revoke
```

## 19.2 Security

These endpoints require:

- strong operator authentication
- device/session binding
- explicit action binding
- short-lived authorization tokens
- replay protection
- audit logging
- rate limiting
- optional World step-up for critical operations

## 19.3 Freeze semantics

Freeze is a capability state transition, not merely a UI flag.

```text
ACTIVE
 ↓
FROZEN
```

Enforcement adapters must be updated or the execution layer must reject the capability locally.

---

# 20. Policy engine

Keep the current policy abstraction and extend it.

## 20.1 Policy inputs

```text
actor
intent
resource
trustContext
evidenceFreshness
currentCapabilities
assuranceState
operatorState
```

## 20.2 Example

```text
IF
  action == TRANSFER
  AND amount > 5000
  AND behaviorIntegrity < 0.80
THEN
  CHALLENGE

IF
  action == CLAIM
  AND amount <= 100
  AND coordinationRisk < 0.30
THEN
  ALLOW

IF
  action == TRADE
  AND trustBand == UNCERTAIN
THEN
  LIMIT amount TO 500
```

## 20.3 Optional Cedar migration

If Cedar is adopted, implement:

```ts
interface PolicyEvaluator {
  evaluate(request: AuthorizationRequest): Promise<AuthorizationResult>;
}
```

The rest of the backend never imports Cedar types directly.

Cedar's official documentation defines authorization in PARC terms and explicitly supports agents acting on behalf of principals through context. citeturn249629search1turn249629search3

---

# 21. Reputation and trust evolution

V2 should maintain a **history of decisions**, not simply one mutable score.

## 21.1 Positive signals

Examples:

```text
successful action
clean behavior
successful challenge
successful task completion
trusted external attestation
```

## 21.2 Negative signals

Examples:

```text
confirmed coordinated cluster
policy violation
failed assurance
behavior drift
repeated abnormal actions
invalidated reputation/attestation
```

## 21.3 Trust decay

Trust must lose weight as evidence becomes stale.

Do not create arbitrary exponential formulas initially.

Start with explicit freshness classes:

```text
FRESH
AGING
STALE
EXPIRED
```

Then use configured policy per signal type.

---

# 22. Attack / Sybil DNA subsystem

V2 should convert confirmed coordinated patterns into reusable patterns.

Example:

```text
Pattern: AIRDROP_RING_01

Funding:
  one -> many

Timing:
  same 60 second window

Behavior:
  DEPOSIT -> BORROW -> REPAY

Wallet age:
  < 48h

Similarity:
  > configured threshold
```

This is not a machine-learned classifier in V2. It is a versioned pattern definition.

Schema:

```text
AttackPattern
PatternSignal
PatternVersion
PatternObservation
```

This creates a reusable intelligence library.

---

# 23. Incidents

Create a dedicated incident model.

```text
Incident
--------
id
actorId nullable
clusterId nullable
campaignId nullable
type
severity
status
openedAt
closedAt
rootCause
investigationId
```

Statuses:

```text
OPEN
INVESTIGATING
MITIGATED
FALSE_POSITIVE
RESOLVED
```

This is what turns live Substreams alerts + AI investigation into an actual security-operations workflow.

---

# 24. API surface — V2

Do not replace the existing V1 routes. Add V2 routes.

## Trust / actors

```http
POST /v2/actors
GET  /v2/actors/:id
GET  /v2/actors/:id/trust
GET  /v2/actors/:id/relationships
GET  /v2/actors/:id/capabilities
```

## Intent / authorization

```http
POST /v2/intents
GET  /v2/intents/:id
POST /v2/intents/:id/re-evaluate
POST /v2/intents/:id/challenge
GET  /v2/intents/:id/receipt
```

## Agents

```http
POST /v2/agents
GET  /v2/agents
GET  /v2/agents/:id
POST /v2/agents/:id/verify
POST /v2/agents/:id/freeze
POST /v2/agents/:id/unfreeze
POST /v2/agents/:id/revoke
GET  /v2/agents/:id/activities
GET  /v2/agents/:id/investigations
```

## Verification

```http
POST /v2/verification/world/start
POST /v2/verification/world/complete
POST /v2/verification/liveness/start
POST /v2/verification/liveness/complete
```

## Incidents

```http
GET  /v2/incidents
POST /v2/incidents/:id/investigate
POST /v2/incidents/:id/mitigate
POST /v2/incidents/:id/resolve
```

## Mobile control

```http
GET  /v2/control/pending-actions
POST /v2/control/actions/:id/approve
POST /v2/control/actions/:id/deny
POST /v2/control/actions/:id/limit
POST /v2/control/agents/:id/freeze
```

---

# 25. Backend module layout

Do not rewrite the whole repository at once.

Recommended additive structure:

```text
backend/src/
├── actor/
│   ├── actor-service.ts
│   ├── actor-resolver.ts
│   ├── identity-service.ts
│   └── relationship-service.ts
│
├── intent/
│   ├── intent-service.ts
│   ├── intent-validator.ts
│   └── intent-types.ts
│
├── trust/
│   ├── trust-context.ts
│   ├── trust-vector.ts
│   ├── trust-bootstrap.ts
│   ├── trust-drift.ts
│   ├── trust-history.ts
│   └── trust-policy.ts
│
├── capabilities/
│   ├── capability-service.ts
│   ├── capability-evaluator.ts
│   ├── capability-lease.ts
│   └── capability-store.ts
│
├── authorization/
│   ├── policy-evaluator.ts
│   ├── cedar-adapter.ts        # only if adopted
│   └── enforcement/
│       ├── enforcement-adapter.ts
│       ├── erc7715-adapter.ts
│       ├── safe-adapter.ts
│       └── oz-adapter.ts
│
├── agents/
│   ├── agent-service.ts
│   ├── agent-verification.ts
│   ├── agentbook.ts
│   └── erc8004.ts
│
├── verification/
│   ├── world/
│   └── active-liveness/
│
├── workflow/
│   ├── temporal-client.ts
│   ├── authorization.workflow.ts
│   ├── incident.workflow.ts
│   └── capability.workflow.ts
│
├── incidents/
│   ├── incident-service.ts
│   └── incident-types.ts
│
├── investigation/
│   └── existing MCP investigator integration
│
├── attack-patterns/
│   ├── pattern-engine.ts
│   └── pattern-repository.ts
│
├── enforcement/
│   └── x402/
│
└── control/
    ├── mobile-control-service.ts
    └── operator-auth.ts
```

---

# 26. Database migration strategy

Do not break V1 tables.

Add V2 tables incrementally.

## Migration order

```text
1. Actor / ActorIdentity
2. Intent
3. TrustSnapshot
4. Capability
5. AuthorizationDecision
6. Agent
7. VerificationSession
8. Attestation
9. Incident
10. ActionReceipt
11. Workflow
12. AttackPattern
13. KnownFunderAddress
```

## Required indexes

At minimum:

```text
ActorIdentity(kind, externalId)
Wallet(address, chainId)
ActorRelationship(fromActorId, relationType)
ActorRelationship(toActorId, relationType)
TrustSnapshot(actorId, createdAt)
Intent(actorId, status, expiresAt)
Capability(actorId, status, expiresAt)
AuthorizationDecision(intentId)
Incident(status, severity, openedAt)
ActionReceipt(intentId)
KnownFunderAddress(chainId, address)
```

---

# 27. Security model

## 27.1 Authentication

Existing API key auth remains for backend-to-backend integration.

Add a separate operator authentication model for mobile control.

Do not reuse a static protocol API key as a mobile-user credential.

## 27.2 Authorization

Every privileged action must check:

```text
operator identity
+ actor scope
+ action scope
+ capability
+ freshness
+ replay protection
```

## 27.3 Replay protection

Continue the V1 nullifier strategy for World flows and add action-level idempotency keys for Intent operations.

## 27.4 Webhook verification

Every external webhook must have:

```text
signature verification
request timestamp
replay window
idempotency key
raw payload hash
```

## 27.5 Fail-closed security boundary

For security-sensitive paths:

```text
Graph unavailable
AND no trustworthy cached evidence
→ do not silently ALLOW
```

Existing V1 `PENDING_REVIEW` behavior must remain available. The audit confirms this is intentional. fileciteturn0file0L194-L196

---

# 28. Privacy architecture

## Store

```text
wallet addresses
public blockchain evidence IDs
derived trust signals
decision metadata
World verification references needed for verification
attestation references
```

## Do not store by default

```text
raw selfie video
raw face images
raw active-liveness camera stream
unnecessary personal identifiers
```

## Derived-only approach

Active liveness should store:

```text
challenge ID
result
signal version
timestamp
session binding
```

The backend should not attempt to reconstruct a face from these values.

---

# 29. Failure handling

## Graph failure

```text
cached fresh evidence -> continue if policy permits
stale/no evidence -> PENDING_REVIEW / CHALLENGE
```

## World failure

```text
workflow remains pending
retry with bounded backoff
never convert transport failure into verification success
```

## AI failure

```text
investigation unavailable
→ deterministic decision can still proceed when sufficient evidence exists
```

AI is enhancement, not a single point of authorization failure.

## Temporal failure

Durable workflow must resume after worker restart/redeployment.

## Enforcement failure

Never return `AUTHORIZED_AND_EXECUTABLE` unless enforcement state is confirmed.

---

# 30. Testing strategy

## 30.1 Existing V1 regression suite

Keep all current tests passing.

The repository audit records 321 test cases with live-network timing variability and explicitly notes there are no `vi.mock()` module mocks in the backend test directory. fileciteturn0file0L172-L180

## 30.2 V2 unit tests

Test:

```text
actor resolution
cold-start states
trust vector calculation
behavior drift
known-funder adjustment
policy evaluation
capability attenuation
capability expiry
intent idempotency
receipt generation
```

## 30.3 Adversarial tests

Must include:

```text
fresh wallet
shared exchange funder
coordinated 5-wallet ring
slow Sybil ring
cross-protocol ring
behavior drift without Sybil
legitimate coordinated users
agent with good reputation + bad current behavior
human-backed agent + malicious action
expired capability
replayed approval
stale World result
stale Graph evidence
AI investigation hallucination / no evidence
```

## 30.4 Workflow tests

Temporal tests must cover:

```text
workflow restart
worker crash
external verification retry
human approval timeout
approval after expiry
live trust change during wait
freeze during pending action
revoke during pending action
```

## 30.5 Integration tests

At minimum:

```text
Graph -> trust -> policy
World -> verification -> policy
ERC-8004 -> trust
Substreams -> invalidation -> re-evaluation
Temporal -> mobile approval -> authorization
x402 -> Xander decision -> service
Safe/OZ -> Xander capability -> execution
```

---

# 31. Benchmarking

V2 is successful only if it measurably improves V1.

Track:

```text
false-positive rate
false-negative rate
detection latency
trust-update latency
authorization latency
challenge completion rate
successful verification rate
investigation success rate
cost per authorization
workflow recovery rate
capability revocation latency
```

Do not invent target numbers before measuring the baseline.

Create four datasets:

```text
synthetic attacks
known real-world patterns
benign coordinated behavior
adversarial adaptive behavior
```

---

# 32. Observability

Every request should carry:

```text
requestId
actorId
intentId
workflowId nullable
traceId
```

Every decision logs:

```text
trust snapshot ID
policy version
decision
reason codes
evidence IDs
latency
```

OpenTelemetry should trace:

```text
API
 -> actor resolution
 -> Graph
 -> trust
 -> policy
 -> World
 -> Temporal
 -> enforcement
 -> receipt
```

This is especially important when debugging a mobile approval or agent execution that may span minutes.

---

# 33. Phase-by-phase implementation plan

## PHASE 0 — Stabilize V1

### Goal

Freeze the proven system before adding V2.

### Work

- complete the remaining V1 joint Phase 25 run
- refresh the seed-fixture timestamp problem
- implement known-funder registry
- update stale README/build-status claims
- create V2 feature branch

### Done when

- clean claim works
- challenge works
- World proof works
- blocked cluster works
- Substreams invalidation works
- MCP investigation works
- existing test suite is green within documented live-network constraints

---

## PHASE 1 — Actor + Intent foundation

### Goal

Move from wallet-centric request handling to actor/action semantics.

### Build

```text
Actor
ActorIdentity
Intent
AuthorizationDecision
ActionReceipt
```

### APIs

```text
POST /v2/actors
GET /v2/actors/:id
POST /v2/intents
GET /v2/intents/:id
```

### Done when

A claim can be represented as an Intent and linked to an Actor without changing the existing claim flow.

---

## PHASE 2 — Trust Context

### Goal

Unify current risk data with new trust dimensions.

### Build

```text
TrustSnapshot
TrustVector
TrustBootstrap
BehaviorDrift
TrustHistory
```

### Done when

The backend can distinguish:

```text
ESTABLISHED_LOW
HIGH_RISK
INSUFFICIENT_EVIDENCE
```

without treating all unknown wallets as low risk.

---

## PHASE 3 — Capability + Policy

### Goal

Turn trust into actionable authorization.

### Build

```text
Capability
CapabilityLease
PolicyEvaluator
```

### Required outcomes

```text
ALLOW
LIMIT
CHALLENGE
REVIEW
BLOCK
```

### Done when

The same actor can receive different capabilities for different actions.

---

## PHASE 4 — Temporal workflows

### Goal

Make long-running authorization durable.

### Build

```text
authorization.workflow
capability.workflow
incident.workflow
```

### Done when

A workflow can survive worker restart, wait for human input, receive a new signal, re-evaluate policy and complete correctly.

---

## PHASE 5 — World Agent + assurance expansion

### Goal

Add human-backed agent creation and step-up assurance.

### Build

```text
Agent
World verification adapter
AgentBook integration
active-liveness challenge service
```

### Done when

A user can create one agent, establish World-backed assurance, complete active liveness, and receive an initial bounded capability set.

---

## PHASE 6 — ERC-8004 agent trust

### Goal

Add standard agent identity/reputation/validation inputs.

### Build

```text
ERC8004 adapter
Agent identity references
Reputation fetcher
Validation status
```

### Done when

An agent's TrustSnapshot includes ERC-8004-derived evidence where available.

---

## PHASE 7 — Live trust mutation

### Goal

Make Substreams change authority, not merely refresh caches.

### Build

```text
actor event processor
behavior drift detector
cluster mutation handler
trust invalidation
Temporal signals
```

### Done when

A new onchain event can change an agent's TrustSnapshot and cause an active capability to be attenuated or frozen.

---

## PHASE 8 — Enforcement

### Goal

Make authorization enforceable.

### First target

Choose **one**:

```text
ERC-7715-compatible permission flow
OR
Safe enforcement
OR
OpenZeppelin AccessManager
```

### Done when

At least one high-value agent action is prevented by Xander policy at the actual execution boundary.

---

## PHASE 9 — x402 agent commerce

### Goal

Prove Xander works outside claims.

### Build

```text
x402 protected endpoint
agent identity lookup
Xander authorization
rate/amount limits
ActionReceipt
```

### Demo

```text
trusted agent -> paid request allowed
unknown agent -> tiny allowance
suspicious agent -> denied
```

---

## PHASE 10 — AI Security Operations

### Goal

Turn the existing MCP investigator into a durable incident workflow.

### Build

```text
Incident
Investigation
investigator workflow
counter-evidence search
incident resolution
```

### Done when

A live anomaly produces a traceable investigation that identifies supporting and contradicting evidence and feeds a deterministic policy decision.

---

## PHASE 11 — Remote Authority

### Goal

Expose the security control plane to a mobile client.

### Build

```text
operator sessions
pending action APIs
approve/deny/limit
freeze/revoke
live agent state
```

### Done when

A mobile client can:

```text
view agent
view evidence
receive pending action
approve
limit
freeze
```

and the decision flows through the durable workflow.

---

## PHASE 12 — Production hardening

### Goal

Make the system deployable.

### Work

- OpenTelemetry
- rate limits
- secrets rotation
- webhook verification
- database indexes
- retention policy
- backup/recovery
- worker autoscaling
- Temporal worker HA
- Graph provider failure policy
- World failure policy
- enforcement reconciliation
- security review

### Done when

A failure in any external dependency produces a known safe state rather than an accidental authorization bypass.

---

# 34. Recommended build order inside each phase

For each phase:

```text
1. types
2. database migration
3. pure business logic
4. service layer
5. API route
6. integration adapter
7. workflow
8. tests
9. observability
10. end-to-end verification
```

Do not start by building UI.

Do not start by deploying contracts.

Do not start by adding another protocol.

The backend contract must stabilize first.

---

# 35. What not to build in V2

Do **not** build these unless a concrete requirement appears:

```text
custom blockchain indexer
Neo4j just for the sake of having a graph DB
Kafka/Redpanda at hackathon scale
multiple LLM providers with no functional need
custom deepfake detector as security authority
full ZK trust system
fully homomorphic trust computation
MPC key infrastructure
five different smart-account systems
full remote desktop / mouse control
universal multi-chain support
```

These increase complexity without strengthening the core Trust Runtime enough to justify their cost.

---

# 36. Final backend flow

```text
                           ACTOR
                  Human / Wallet / Agent
                              │
                              ▼
                           INTENT
              "I want to perform ACTION X"
                              │
                              ▼
                     ACTOR RESOLUTION
                              │
                              ▼
                     TRUST CONTEXT
                              │
        ┌─────────────────────┼──────────────────────┐
        │                     │                      │
        ▼                     ▼                      ▼
      Graph                 World                External
        │                     │                  reputation
  behavior graph        human assurance       ERC-8004 / EAS
  relationships         AgentKit/Book
  live events
        └─────────────────────┼──────────────────────┘
                              │
                              ▼
                         TRUST VECTOR
                              │
                              ▼
                       AI INVESTIGATION
                       when evidence needs it
                              │
                              ▼
                       POLICY EVALUATION
                              │
             ┌────────────────┼─────────────────┐
             ▼                ▼                 ▼
           ALLOW            LIMIT           CHALLENGE
                                                │
                                  ┌─────────────┴─────────────┐
                                  ▼                           ▼
                              World check               Active liveness
                                  │                           │
                                  └─────────────┬─────────────┘
                                                ▼
                                           RE-EVALUATE
                                                │
                 ┌──────────────────────────────┼───────────────┐
                 ▼                              ▼               ▼
              CAPABILITY                      REVIEW          BLOCK
                 │
                 ▼
             ENFORCEMENT
          x402 / ERC-7715 / Safe / OZ
                 │
                 ▼
              EXECUTION
                 │
                 ▼
            ACTION RECEIPT
                 │
                 ▼
             SUBSTREAMS
                 │
                 ▼
        NEW ACTOR / BEHAVIOR DATA
                 │
                 ▼
              TRUST CHANGE
                 │
                 ▼
             CAPABILITY CHANGE
                 │
          ┌──────┴──────┐
          ▼             ▼
       CONTINUE       INCIDENT
                         │
                         ▼
                  TEMPORAL WORKFLOW
                         │
                         ▼
                   AI INVESTIGATOR
                         │
                         ▼
                    POLICY AGAIN
                         │
                         ▼
                    📱 COMMAND
                         │
                 approve / limit /
                 freeze / revoke
```

---

# 37. What “complete V2 backend” means

V2 backend is complete when all of the following are true:

### Foundation

- [ ] V1 regression suite preserved
- [ ] V1 Phase 25 joint wiring completed
- [ ] Known-funder registry implemented
- [ ] Actor model exists
- [ ] Intent model exists

### Trust

- [ ] Trust Context exists
- [ ] cold-start state exists
- [ ] behavior drift exists
- [ ] historical trust exists
- [ ] evidence freshness is enforced

### Authorization

- [ ] policy engine evaluates actor + action + resource + context
- [ ] capabilities exist
- [ ] capability limits exist
- [ ] capability expiry exists
- [ ] decision receipts exist

### World

- [ ] Selfie Check path works
- [ ] human-backed agent path works
- [ ] active liveness path works
- [ ] verification replay protection works

### Agent

- [ ] agent creation works
- [ ] ERC-8004 reference works
- [ ] agent capabilities work
- [ ] agent freeze/revoke works

### Graph

- [ ] Token API used
- [ ] Standardized Subgraphs used
- [ ] Substreams changes trust state
- [ ] MCP investigation works
- [ ] actor relationships are stored

### Workflow

- [ ] Temporal authorization workflow works
- [ ] Temporal human approval works
- [ ] Temporal recovery works
- [ ] capability leases work

### Enforcement

- [ ] one real onchain enforcement adapter works
- [ ] x402 flow works
- [ ] failed enforcement fails closed

### Operations

- [ ] incidents exist
- [ ] AI investigation produces evidence-backed output
- [ ] mobile control API works
- [ ] audit trail works
- [ ] OpenTelemetry traces decisions end-to-end

---

# 38. Final build principle

The project should never again be described internally as:

> wallet -> score -> World -> claim

The V2 backend is:

```text
ACTOR
  ↓
INTENT
  ↓
EVIDENCE
  ↓
TRUST CONTEXT
  ↓
INVESTIGATION (when needed)
  ↓
POLICY
  ↓
CAPABILITY
  ↓
ENFORCEMENT
  ↓
ACTION
  ↓
CONTINUOUS OBSERVATION
  ↓
TRUST CHANGE
  ↓
CAPABILITY CHANGE
```

The existing Sybil detector remains the first specialized risk engine inside this loop.

The existing World integration remains the primary human/uniqueness assurance path.

The Graph remains the behavioral evidence substrate.

Temporal becomes the durable workflow runtime.

ERC-8004 becomes the agent identity/reputation/validation layer.

x402 becomes one concrete agent-commerce action path.

ERC-7715 / ERC-4337 / Safe / OpenZeppelin become enforcement adapters rather than the trust engine itself.

The mobile application becomes a control plane for authority, not a remote desktop.

This gives V2 one coherent backend architecture with multiple product surfaces rather than multiple disconnected features.

---

# 39. External verification sources

Primary external sources used for this specification:

- The Graph Subgraphs: https://thegraph.com/subgraphs/
- The Graph Token API: https://thegraph.com/blog/token-api-the-graph/
- The Graph Substreams: https://thegraph.com/substreams/
- The Graph technical roadmap: https://thegraph.com/blog/technical-roadmap/
- The Graph hackathon resources: https://thegraph.com/blog/hackathon-resources/
- The Graph MCP / AI querying: https://thegraph.com/blog/querying-blockchain-data-natural-language-mcp-skills/
- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004
- ERC-7715: https://eips.ethereum.org/EIPS/eip-7715
- ERC-4337: https://eips.ethereum.org/EIPS/eip-4337
- Cedar authorization: https://docs.cedarpolicy.com/auth/authorization.html

World API/SDK details should always be re-checked against the currently installed World SDK and current official documentation immediately before implementation; this document intentionally does not invent endpoint names where the source material did not verify them.

---

# Final recommendation

Build V2 in this order:

```text
V1 STABILIZATION
      ↓
ACTOR + INTENT
      ↓
TRUST CONTEXT
      ↓
CAPABILITIES + POLICY
      ↓
TEMPORAL
      ↓
WORLD AGENT + LIVENESS
      ↓
ERC-8004
      ↓
SUBSTREAM-DRIVEN LIVE TRUST
      ↓
ENFORCEMENT
      ↓
X402
      ↓
AI INCIDENT INVESTIGATION
      ↓
MOBILE REMOTE AUTHORITY
      ↓
PRODUCTION HARDENING
```

This sequence minimizes rework because each phase adds a layer on top of an already stable contract instead of replacing the core engine.
