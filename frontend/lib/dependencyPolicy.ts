/**
 * A static mirror of `backend/src/hardening/dependency-policy.ts` — the real
 * Phase 12 table. `/ready` only reports 3 of these 12 live (Postgres, Redis,
 * Temporal); the rest have no HTTP surface, so this ships as a static
 * reference table alongside the live `/ready` data rather than pretending
 * the console can poll them.
 */
export interface DependencyPolicy {
  dependency: string
  affects: string
  behaviour: string
  canStillAuthorize: boolean
  rationale: string
  enforcedIn: string
}

export const DEPENDENCY_POLICIES: readonly DependencyPolicy[] = [
  { dependency: 'POSTGRES', affects: 'everything — evidence, trust, capabilities, receipts', behaviour: 'REFUSE_ALL', canStillAuthorize: false, rationale: 'Every authorization rests on stored evidence and a stored capability. With no database there is nothing to authorize against.', enforcedIn: 'prisma throws; the route error handler returns 5xx' },
  { dependency: 'REDIS', affects: 'the risk cache and the invalidation queue', behaviour: 'DEGRADE_LOCAL_ONLY', canStillAuthorize: true, rationale: 'The cache is an optimisation over Postgres, never a source of truth. A miss recomputes from evidence.', enforcedIn: 'src/cache/risk-cache.ts falls through to a live computation' },
  { dependency: 'GRAPH_TOKEN_API', affects: 'fresh on-chain evidence for a wallet', behaviour: 'HOLD_FOR_REVIEW', canStillAuthorize: false, rationale: 'Graph unavailable and no trustworthy cached evidence must not silently ALLOW.', enforcedIn: 'src/risk/freshness-guard.ts -> PENDING_REVIEW' },
  { dependency: 'GRAPH_SUBGRAPHS', affects: 'protocol-level evidence', behaviour: 'HOLD_FOR_REVIEW', canStillAuthorize: false, rationale: 'Same as the Token API: missing evidence is not benign evidence.', enforcedIn: 'src/risk/freshness-guard.ts' },
  { dependency: 'SUBSTREAMS', affects: 'live event streaming and trust invalidation', behaviour: 'HOLD_FOR_REVIEW', canStillAuthorize: false, rationale: 'A dead stream means trust stops updating; a stale cursor is treated as unmeasurable.', enforcedIn: 'src/risk/freshness-guard.ts stream-lag check' },
  { dependency: 'SUBGRAPH_MCP', affects: 'AI investigation', behaviour: 'DEGRADE_TO_UNKNOWN', canStillAuthorize: true, rationale: 'The investigator is advisory and can only tighten a decision, never loosen it.', enforcedIn: 'src/incidents/incident-service.ts decides without a finding' },
  { dependency: 'WORLD', affects: 'human assurance and operator step-up', behaviour: 'REFUSE_ACTION', canStillAuthorize: false, rationale: 'An action that requires human assurance cannot proceed without it.', enforcedIn: 'src/world/idkit-verify.ts throws' },
  { dependency: 'TEMPORAL', affects: 'durable workflows and operator signals', behaviour: 'DEGRADE_LOCAL_ONLY', canStillAuthorize: true, rationale: 'Every enforcement action is applied locally first; the signal is the mirror, not the source of truth.', enforcedIn: 'incident-service and control-service both return, never throw' },
  { dependency: 'ENS_RPC', affects: 'on-chain agent identity and EAC role enforcement', behaviour: 'REFUSE_ACTION', canStillAuthorize: false, rationale: 'An unreachable boundary yields UNKNOWN, and UNKNOWN is not proof of authorization.', enforcedIn: 'src/authorization/enforcement/ens-eac-adapter.ts returns enforceable: null' },
  { dependency: 'ERC8004_RPC', affects: 'external agent reputation', behaviour: 'DEGRADE_TO_UNKNOWN', canStillAuthorize: true, rationale: 'ERC-8004 is advisory. An unreadable registry yields a null reputation dimension, never a fabricated number.', enforcedIn: 'src/agents/erc8004.ts toAgentReputationValue returns value: null' },
  { dependency: 'X402_FACILITATOR', affects: 'agent commerce payments', behaviour: 'REFUSE_ACTION', canStillAuthorize: false, rationale: 'A payment that cannot be verified must not be served, and one that cannot be settled must not be reported as paid.', enforcedIn: 'src/x402/x402-service.ts throws X402Error(503)' },
  { dependency: 'ANTHROPIC', affects: 'the investigation narrative', behaviour: 'DEGRADE_TO_UNKNOWN', canStillAuthorize: true, rationale: 'Advisory only — a missing narrative loses explanation, not enforcement.', enforcedIn: 'src/mcp/investigation-agent.ts records a FAILED investigation' },
]
