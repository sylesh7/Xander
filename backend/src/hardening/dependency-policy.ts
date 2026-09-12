/**
 * What every external dependency's failure MEANS — Xander V2 spec section 33,
 * Phase 12, and section 27.5.
 *
 * The acceptance condition for this phase is one sentence:
 *
 *   "A failure in any external dependency produces a KNOWN SAFE STATE rather
 *    than an accidental authorization bypass."
 *
 * "Known" is the operative word. It is not enough that the system happens to
 * behave safely when The Graph is down; the behaviour has to be WRITTEN DOWN,
 * enumerated per dependency, and testable. This file is that table, and
 * `test/dependency-policy.test.ts` walks every row of it.
 *
 * The failure mode this guards against is subtle and specific: a dependency
 * that fails OPEN is almost never obvious in code review, because the code that
 * skips a check looks like the code that passes one. Naming each dependency and
 * asserting its degraded behaviour is the only way to keep that honest.
 *
 * Pure. No database, no network, no clock.
 */

/** Every external thing Xander depends on. */
export const DEPENDENCIES = [
  'POSTGRES',
  'REDIS',
  'GRAPH_TOKEN_API',
  'GRAPH_SUBGRAPHS',
  'SUBSTREAMS',
  'SUBGRAPH_MCP',
  'WORLD',
  'TEMPORAL',
  'ENS_RPC',
  'ERC8004_RPC',
  'X402_FACILITATOR',
  'ANTHROPIC',
] as const
export type Dependency = (typeof DEPENDENCIES)[number]

/**
 * What Xander does when a dependency is unavailable.
 *
 * Ordered from most to least restrictive. Every value here withholds or
 * degrades authority; there is deliberately no `IGNORE`, because "carry on as
 * if nothing happened" is the bypass this table exists to prevent.
 */
export const DEGRADED_BEHAVIOURS = [
  /** Nothing works. The service cannot answer at all. */
  'REFUSE_ALL',
  /** Authorization decisions hold for human review. Section 27.5. */
  'HOLD_FOR_REVIEW',
  /** The action is refused, but other paths keep working. */
  'REFUSE_ACTION',
  /** Works, but the affected signal reads UNKNOWN rather than a number. */
  'DEGRADE_TO_UNKNOWN',
  /** Works with reduced durability; the local effect already happened. */
  'DEGRADE_LOCAL_ONLY',
] as const
export type DegradedBehaviour = (typeof DEGRADED_BEHAVIOURS)[number]

export interface DependencyPolicy {
  dependency: Dependency
  /** What breaks. */
  affects: string
  behaviour: DegradedBehaviour
  /** Whether an authorization can still be GRANTED while this is down. */
  canStillAuthorize: boolean
  /** Why this is the safe answer, in one sentence an operator can act on. */
  rationale: string
  /** Where the behaviour actually lives, so a reviewer can check the claim. */
  enforcedIn: string
}

/**
 * THE TABLE. One row per dependency, no exceptions and no defaults.
 *
 * `canStillAuthorize: true` appears only where the dependency cannot influence
 * an authorization decision at all. Every row where it could is `false`.
 */
export const DEPENDENCY_POLICIES: readonly DependencyPolicy[] = [
  {
    dependency: 'POSTGRES',
    affects: 'everything — evidence, trust, capabilities, receipts',
    behaviour: 'REFUSE_ALL',
    canStillAuthorize: false,
    rationale:
      'Every authorization rests on stored evidence and a stored capability. With no database there is nothing to authorize against, and answering from memory would be authorizing on no evidence at all.',
    enforcedIn: 'prisma throws; the route error handler returns 5xx',
  },
  {
    dependency: 'REDIS',
    affects: 'the risk cache and the invalidation queue',
    behaviour: 'DEGRADE_LOCAL_ONLY',
    canStillAuthorize: true,
    rationale:
      'The cache is an optimisation over Postgres, never a source of truth. A miss recomputes from evidence, which is slower and equally correct. Queue loss delays re-evaluation but cannot grant anything.',
    enforcedIn: 'src/cache/risk-cache.ts falls through to a live computation',
  },
  {
    dependency: 'GRAPH_TOKEN_API',
    affects: 'fresh on-chain evidence for a wallet',
    behaviour: 'HOLD_FOR_REVIEW',
    canStillAuthorize: false,
    rationale:
      'Section 27.5: Graph unavailable AND no trustworthy cached evidence must not silently ALLOW. Stale or absent evidence means the actor is unmeasurable, and unmeasurable is REVIEW.',
    enforcedIn: 'src/risk/freshness-guard.ts -> PENDING_REVIEW -> intent-service fail-closed gate',
  },
  {
    dependency: 'GRAPH_SUBGRAPHS',
    affects: 'protocol-level evidence',
    behaviour: 'HOLD_FOR_REVIEW',
    canStillAuthorize: false,
    rationale: 'Same as the Token API: missing evidence is not benign evidence.',
    enforcedIn: 'src/risk/freshness-guard.ts',
  },
  {
    dependency: 'SUBSTREAMS',
    affects: 'live event streaming and trust invalidation',
    behaviour: 'HOLD_FOR_REVIEW',
    canStillAuthorize: false,
    rationale:
      'A dead stream means trust stops updating. The freshness guard treats a stale SubstreamsCursor as unmeasurable rather than letting an actor coast on a snapshot nobody is refreshing.',
    enforcedIn: 'src/risk/freshness-guard.ts stream-lag check',
  },
  {
    dependency: 'SUBGRAPH_MCP',
    affects: 'AI investigation',
    behaviour: 'DEGRADE_TO_UNKNOWN',
    canStillAuthorize: true,
    rationale:
      'The investigator is advisory (section 15.3) and can only tighten a decision. Losing it loses an escalation path, never a restriction — the deterministic counter-evidence search still runs.',
    enforcedIn: 'src/incidents/incident-service.ts decides without a finding',
  },
  {
    dependency: 'WORLD',
    affects: 'human assurance and operator step-up',
    behaviour: 'REFUSE_ACTION',
    canStillAuthorize: false,
    rationale:
      'An action that REQUIRES human assurance cannot proceed without it. The verification fails and the capability is never granted; it must never fall back to granting on trust alone.',
    enforcedIn: 'src/world/idkit-verify.ts throws; agent-service refuses the transition',
  },
  {
    dependency: 'TEMPORAL',
    affects: 'durable workflows and operator signals',
    behaviour: 'DEGRADE_LOCAL_ONLY',
    canStillAuthorize: true,
    rationale:
      'Every enforcement action is applied locally FIRST and the signal is the mirror. A freeze that could not be signalled has still frozen the capability; throwing here would roll back a real containment because a workflow engine was down.',
    enforcedIn: 'incident-service.startIncidentWorkflow and control-service.signalWorkflow both return, never throw',
  },
  {
    dependency: 'ENS_RPC',
    affects: 'on-chain agent identity and EAC role enforcement',
    behaviour: 'REFUSE_ACTION',
    canStillAuthorize: false,
    rationale:
      'Section 18.2: an unreachable boundary yields UNKNOWN, and UNKNOWN is not proof of authorization. The execution gate requires every applicable boundary to positively confirm, so an unreachable chain refuses the action rather than assuming it.',
    enforcedIn: 'src/authorization/enforcement/ens-eac-adapter.ts returns enforceable: null',
  },
  {
    dependency: 'ERC8004_RPC',
    affects: 'external agent reputation',
    behaviour: 'DEGRADE_TO_UNKNOWN',
    canStillAuthorize: true,
    rationale:
      'Section 16.2 makes ERC-8004 advisory. An unreadable registry yields a null reputation dimension, never a fabricated number — and a null cannot raise a trust band.',
    enforcedIn: 'src/agents/erc8004.ts toAgentReputationValue returns value: null',
  },
  {
    dependency: 'X402_FACILITATOR',
    affects: 'agent commerce payments',
    behaviour: 'REFUSE_ACTION',
    canStillAuthorize: false,
    rationale:
      'A payment that cannot be verified must not be served, and one that cannot be settled must not be reported as paid. Both paths return 503 and the resource is withheld.',
    enforcedIn: 'src/x402/x402-service.ts throws X402Error(503) on verify and settle failure',
  },
  {
    dependency: 'ANTHROPIC',
    affects: 'the investigation narrative',
    behaviour: 'DEGRADE_TO_UNKNOWN',
    canStillAuthorize: true,
    rationale:
      'Same as the MCP: advisory only. A missing narrative loses explanation, not enforcement.',
    enforcedIn: 'src/mcp/investigation-agent.ts records a FAILED investigation',
  },
]

/** The policy for one dependency. Throws for an unknown one, never guesses. */
export function policyFor(dependency: string): DependencyPolicy {
  const found = DEPENDENCY_POLICIES.find((p) => p.dependency === dependency)
  if (!found) {
    // A dependency with no written policy is exactly the gap this file exists
    // to close, so it is an error rather than a permissive default.
    throw new Error(`No degradation policy is defined for "${dependency}".`)
  }
  return found
}

/**
 * Can an authorization still be GRANTED with this set of dependencies down?
 *
 * The whole acceptance condition in one function: if any unavailable dependency
 * is one that could influence a decision, the answer is no.
 */
export function canAuthorizeWithout(unavailable: readonly string[]): {
  canAuthorize: boolean
  blockedBy: string[]
  reasons: string[]
} {
  const blocking = unavailable
    .map((d) => policyFor(d))
    .filter((p) => !p.canStillAuthorize)
  return {
    canAuthorize: blocking.length === 0,
    blockedBy: blocking.map((p) => p.dependency),
    reasons: blocking.map((p) => `${p.dependency}: ${p.behaviour} — ${p.rationale}`),
  }
}

/** Every dependency whose loss must stop an authorization. */
export function authorizationCriticalDependencies(): Dependency[] {
  return DEPENDENCY_POLICIES.filter((p) => !p.canStillAuthorize).map((p) => p.dependency)
}
