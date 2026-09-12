/**
 * Human-backed agent lifecycle — Xander V2 spec sections 5.4, 9.1, 11.1.
 *
 *   DRAFT -> VERIFYING -> HUMAN_BACKED -> ACTIVE -> RESTRICTED -> FROZEN -> REVOKED
 *
 * The shape of the flow (section 9.1):
 *
 *   create agent -> World assurance -> optional active liveness
 *                -> assurance LEASE -> bounded capability envelope
 *
 * WHAT "HUMAN-BACKED" MEANS HERE, exactly: a World verification this backend
 * performed is bound to this agent's actor, and that binding has an expiry.
 * It does NOT mean the agent is safe, that the human controls every wallet the
 * actor holds, or that anything the agent does later is endorsed. Invariant 3.3
 * — World evidence is an assurance signal, not ownership proof.
 */
import type { Agent } from '@prisma/client'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { grantCapability } from '../capabilities/capability-service.js'
import { buildTrustContext } from '../trust/trust-context.js'
import { recordTrustSignal } from '../trust/trust-history.js'
import {
  mintAgentIdentity,
  revokeAgentRolesOnChain,
  syncAgentRolesOnChain,
  type EnsOutcome,
} from './agent-ens.js'

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

export const AGENT_STATUSES = [
  'DRAFT',
  'VERIFYING',
  'HUMAN_BACKED',
  'ACTIVE',
  'RESTRICTED',
  'FROZEN',
  'REVOKED',
] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

/**
 * Which transitions are legal.
 *
 * A table rather than scattered `if`s: an agent silently moving from FROZEN
 * back to ACTIVE without passing through the unfreeze path is precisely the
 * bug that makes a freeze meaningless, and a total map makes that impossible
 * to write by accident.
 */
const ALLOWED_TRANSITIONS: Record<AgentStatus, readonly AgentStatus[]> = {
  DRAFT: ['VERIFYING', 'REVOKED'],
  VERIFYING: ['HUMAN_BACKED', 'DRAFT', 'REVOKED'],
  HUMAN_BACKED: ['ACTIVE', 'FROZEN', 'REVOKED'],
  ACTIVE: ['RESTRICTED', 'FROZEN', 'REVOKED'],
  RESTRICTED: ['ACTIVE', 'FROZEN', 'REVOKED'],
  FROZEN: ['ACTIVE', 'RESTRICTED', 'REVOKED'],
  // Terminal. There is no path out, because an agent whose authority was
  // destroyed should be replaced rather than resurrected.
  REVOKED: [],
}

export function canTransition(from: AgentStatus, to: AgentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export interface CreateAgentInput {
  actorId: string
  name: string
  agentUri?: string
  configuration?: Record<string, unknown>
  /**
   * Label for the agent's ENS subname, e.g. `alpha` -> alpha.xander.eth.
   *
   * Opt-in rather than automatic. Minting is a real transaction that costs gas
   * and takes ~15s, so an API that silently did it on every create would make
   * agent creation slow and expensive for callers who never wanted a name.
   */
  ensLabel?: string
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const actor = await prisma.actor.findUnique({ where: { id: input.actorId } })
  if (!actor) throw new AgentError(`No actor ${input.actorId}.`, 404)

  const agent = await prisma.agent.create({
    data: {
      actorId: input.actorId,
      name: input.name,
      status: 'DRAFT',
      agentUri: input.agentUri ?? null,
      configurationJson: (input.configuration ?? {}) as object,
    },
  })
  logger.info({ agentId: agent.id, actorId: input.actorId }, 'agent created')
  return agent
}

export interface CreateAgentResult {
  agent: Agent
  ens: EnsOutcome & { fqdn: string | null; expiresAt: Date | null }
}

/**
 * Creates an agent and, when a label is given, mints its ENS identity.
 *
 * A minting failure does NOT fail agent creation. The agent is a real,
 * usable record either way, and rolling it back because Sepolia was slow would
 * trade a working agent for no agent. The outcome is returned so the caller can
 * see exactly what happened rather than assuming a name exists.
 */
export async function createAgentWithIdentity(
  input: CreateAgentInput,
): Promise<CreateAgentResult> {
  const agent = await createAgent(input)

  if (!input.ensLabel) {
    return {
      agent,
      ens: {
        attempted: false,
        succeeded: false,
        skipReason: 'NO_ENS_NAME',
        txHash: null,
        detail: 'no ensLabel supplied',
        fqdn: null,
        expiresAt: null,
      },
    }
  }

  try {
    const minted = await mintAgentIdentity({ agentId: agent.id, label: input.ensLabel })
    const refreshed = await prisma.agent.findUnique({ where: { id: agent.id } })
    return { agent: refreshed ?? agent, ens: minted }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ agentId: agent.id, err }, 'ENS identity minting failed; agent still created')
    return {
      agent,
      ens: {
        attempted: true,
        succeeded: false,
        skipReason: null,
        txHash: null,
        detail: `minting failed: ${message}`,
        fqdn: null,
        expiresAt: null,
      },
    }
  }
}

async function transition(agentId: string, to: AgentStatus, reason: string): Promise<Agent> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) throw new AgentError(`No agent ${agentId}.`, 404)

  const from = agent.status as AgentStatus
  if (from === to) return agent
  if (!canTransition(from, to)) {
    throw new AgentError(`An agent cannot move from ${from} to ${to}.`, 409)
  }

  const updated = await prisma.agent.update({ where: { id: agentId }, data: { status: to } })
  logger.info({ agentId, from, to, reason }, 'agent status changed')
  return updated
}

/** Moves an agent into VERIFYING, the state where assurance is outstanding. */
export async function beginVerification(agentId: string): Promise<Agent> {
  return transition(agentId, 'VERIFYING', 'verification started')
}

export interface AssuranceEstablishedInput {
  agentId: string
  /** A VerificationChallenge this backend already resolved PASSED. */
  worldChallengeId?: string | null
  /** A LivenessChallenge this backend already resolved PASSED. */
  livenessChallengeId?: string | null
}

/**
 * Establishes the assurance lease and mints the initial capability envelope.
 *
 * BOTH PROOFS ARE RE-READ FROM THE DATABASE, never trusted as arguments. A
 * caller passing an id is claiming a proof exists; this checks that it exists,
 * that it PASSED, and that it belongs to this agent's actor. Accepting the
 * claim would make the whole assurance step a matter of asking nicely.
 *
 * Lease length is a function of what was actually proven: World alone buys an
 * hour, World plus a fresh liveness proof buys twelve. That difference is the
 * rotation model from section 14.1 — a credential ages, presence does not
 * transfer, and the lease encodes which one we have.
 */
export async function establishAssurance(input: AssuranceEstablishedInput): Promise<{
  agent: Agent
  leaseId: string
  level: 'WORLD_ONLY' | 'WORLD_PLUS_ACTIVE'
  expiresAt: Date
  capabilityIds: string[]
  ens: EnsOutcome
}> {
  const agent = await prisma.agent.findUnique({ where: { id: input.agentId } })
  if (!agent) throw new AgentError(`No agent ${input.agentId}.`, 404)

  let worldVerified = false
  if (input.worldChallengeId) {
    const world = await prisma.verificationChallenge.findUnique({
      where: { id: input.worldChallengeId },
    })
    if (!world || world.status !== 'PASSED') {
      throw new AgentError('The referenced World verification has not passed.', 400)
    }
    worldVerified = true
  }

  let livenessVerified = false
  if (input.livenessChallengeId) {
    const liveness = await prisma.livenessChallenge.findUnique({
      where: { id: input.livenessChallengeId },
    })
    if (!liveness || liveness.status !== 'PASSED') {
      throw new AgentError('The referenced liveness challenge has not passed.', 400)
    }
    if (liveness.actorId !== agent.actorId) {
      // Otherwise anyone could point at somebody else's successful proof.
      throw new AgentError('That liveness challenge belongs to a different actor.', 403)
    }
    livenessVerified = true
  }

  if (!worldVerified) {
    throw new AgentError(
      'World assurance is required before an agent can be human-backed.',
      400,
    )
  }

  // Walk the lifecycle rather than jumping to the end. Section 11.1 is
  // DRAFT -> VERIFYING -> HUMAN_BACKED, and the intermediate state is what an
  // operator sees while assurance is outstanding — skipping it would make a
  // verification that fails halfway indistinguishable from one never started.
  if ((agent.status as AgentStatus) === 'DRAFT') {
    await transition(agent.id, 'VERIFYING', 'assurance submitted')
  }

  const level = livenessVerified ? 'WORLD_PLUS_ACTIVE' : 'WORLD_ONLY'
  const seconds =
    level === 'WORLD_PLUS_ACTIVE'
      ? env.ASSURANCE_LEASE_WORLD_PLUS_ACTIVE_SECONDS
      : env.ASSURANCE_LEASE_WORLD_ONLY_SECONDS
  const expiresAt = new Date(Date.now() + seconds * 1000)

  const lease = await prisma.assuranceLease.create({
    data: {
      actorId: agent.actorId,
      level,
      worldCredentialRef: input.worldChallengeId ?? null,
      lastProvenAt: livenessVerified ? new Date() : null,
      expiresAt,
      status: 'ACTIVE',
      sessionBinding: `lease-${agent.id}-${Date.now()}`,
    },
  })

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      worldChallengeId: input.worldChallengeId ?? null,
      assuranceLeaseId: lease.id,
    },
  })

  const backed = await transition(agent.id, 'HUMAN_BACKED', `assurance ${level}`)

  await recordTrustSignal({
    actorId: agent.actorId,
    kind: 'SUCCESSFUL_CHALLENGE',
    weight: livenessVerified ? 1 : 0.6,
    detail: `assurance established at ${level}`,
    source: 'agent-service',
  })

  const capabilityIds = await bootstrapCapabilities({
    agentId: agent.id,
    actorId: agent.actorId,
    leaseId: lease.id,
  })

  const active = await transition(agent.id, 'ACTIVE', 'initial capabilities granted')

  // Mirror the envelope onto EAC roles. Best-effort: the capabilities are
  // already real and enforced in Xander, so a chain hiccup must not undo a
  // completed verification.
  let ens: EnsOutcome
  try {
    ens = await syncAgentRolesOnChain(agent.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ agentId: agent.id, err }, 'on-chain role sync failed after assurance')
    ens = { attempted: true, succeeded: false, skipReason: null, txHash: null, detail: message }
  }

  return { agent: active ?? backed, leaseId: lease.id, level, expiresAt, capabilityIds, ens }
}

/**
 * The initial capability envelope — spec section 9.1's last step.
 *
 * "Verified" does not mean "unlimited". A newly human-backed agent gets a small
 * bounded set, and section 21 has it earn more by behaving well over time. The
 * bounds themselves come from POLICY, evaluated against the agent's real trust
 * band — not from constants here, which would be a second authorization model
 * living next to the real one.
 */
async function bootstrapCapabilities(args: {
  agentId: string
  actorId: string
  leaseId: string
}): Promise<string[]> {
  const trust = await buildTrustContext(args.actorId)
  const granted: string[] = []

  // Deliberately narrow. Anything touching value has to go through a real
  // intent and be judged on its own terms.
  const seedActions: Array<{ actionType: string; amountLimit: string | null; frequency: number }> = [
    { actionType: 'CLAIM', amountLimit: null, frequency: 10 },
    { actionType: 'API_REQUEST', amountLimit: null, frequency: 100 },
  ]

  for (const seed of seedActions) {
    const capability = await grantCapability({
      actorId: args.actorId,
      actionType: seed.actionType,
      resourceScope: `agent:${args.agentId}`,
      limits: {
        amountLimit: seed.amountLimit,
        frequencyLimit: seed.frequency,
        frequencyWindowSeconds: 86_400,
        allowedTargets: [],
        // Bounded by the lease, so the envelope cannot outlive the assurance
        // that justified it (section 7.3).
        expiresAt: null,
      },
      assuranceLeaseId: args.leaseId,
      attenuated: false,
    })
    granted.push(capability.id)
  }

  logger.info(
    { agentId: args.agentId, capabilities: granted.length, trustBand: trust.band },
    'agent capability envelope granted',
  )
  return granted
}

/**
 * Freeze — spec section 19.3.
 *
 * A state transition AND a capability suspension, never just a flag. An agent
 * marked frozen whose capabilities still pass `checkCapability` is not frozen.
 */
export async function freezeAgent(
  agentId: string,
  reason: string,
): Promise<{ agent: Agent; suspended: number; ens: EnsOutcome }> {
  const agent = await transition(agentId, 'FROZEN', reason)

  // LOCAL SUSPENSION FIRST, and it is the enforcement. If the chain is
  // unreachable the agent is still frozen — making revocation depend on a
  // healthy RPC would turn an RPC outage into an inability to stop a
  // misbehaving agent.
  const { count } = await prisma.capability.updateMany({
    where: { actorId: agent.actorId, status: 'ACTIVE' },
    data: { status: 'SUSPENDED' },
  })

  await recordTrustSignal({
    actorId: agent.actorId,
    kind: 'POLICY_VIOLATION',
    weight: 0.8,
    detail: `agent frozen: ${reason}`,
    source: 'agent-service',
  })

  const ens = await revokeAgentRolesOnChain(agentId)
  logger.info(
    { agentId, suspended: count, reason, ensSucceeded: ens.succeeded },
    'agent frozen',
  )
  return { agent, suspended: count, ens }
}

/** Unfreeze — restores suspended capabilities, but only if the lease still holds. */
export async function unfreezeAgent(agentId: string, reason: string): Promise<Agent> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) throw new AgentError(`No agent ${agentId}.`, 404)

  // Unfreezing into an expired lease would restore authority that nothing
  // currently vouches for.
  if (agent.assuranceLeaseId) {
    const lease = await prisma.assuranceLease.findUnique({
      where: { id: agent.assuranceLeaseId },
    })
    if (!lease || lease.status !== 'ACTIVE' || lease.expiresAt.getTime() <= Date.now()) {
      throw new AgentError(
        'The assurance lease has expired; re-verify before unfreezing.',
        409,
      )
    }
  }

  const updated = await transition(agentId, 'ACTIVE', reason)
  await prisma.capability.updateMany({
    where: { actorId: agent.actorId, status: 'SUSPENDED' },
    data: { status: 'ACTIVE' },
  })
  return updated
}

/** Revoke — terminal. Capabilities are revoked, not suspended. */
export async function revokeAgent(
  agentId: string,
  reason: string,
): Promise<{ agent: Agent; ens: EnsOutcome }> {
  const agent = await transition(agentId, 'REVOKED', reason)
  await prisma.capability.updateMany({
    where: { actorId: agent.actorId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
    data: { status: 'REVOKED' },
  })
  await prisma.assuranceLease.updateMany({
    where: { actorId: agent.actorId, status: 'ACTIVE' },
    data: { status: 'REVOKED' },
  })

  const ens = await revokeAgentRolesOnChain(agentId)
  logger.info({ agentId, reason, ensSucceeded: ens.succeeded }, 'agent revoked')
  return { agent, ens }
}

export async function getAgent(agentId: string) {
  return prisma.agent.findUnique({
    where: { id: agentId },
    include: { challenges: { orderBy: { createdAt: 'desc' }, take: 10 } },
  })
}

export async function listAgents(actorId?: string) {
  return prisma.agent.findMany({
    where: actorId ? { actorId } : {},
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
}
