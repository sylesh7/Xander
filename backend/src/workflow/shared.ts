/**
 * The contract between workflows and everything else — Xander V2 Phase 4.
 *
 * Pure types and signal/query definitions only. Workflow code runs in a
 * deterministic sandbox with no I/O, so anything a workflow imports must be
 * free of database handles, network clients and clocks. Keeping that boundary
 * in its own file makes an accidental import obvious rather than a runtime
 * "cannot access Node API from workflow" much later.
 */
import { defineQuery, defineSignal } from '@temporalio/workflow'
import type { AuthorizationResult } from '../intent/intent-types.js'

/**
 * Operator commands — spec section 14.2. These are the mobile control plane's
 * verbs, delivered as Temporal signals so they reach a workflow that may have
 * been waiting for hours across a worker restart.
 */
export const OPERATOR_COMMANDS = [
  'APPROVE',
  'DENY',
  'LIMIT',
  'FREEZE',
  'UNFREEZE',
  'REVOKE',
  'EXTEND',
] as const
export type OperatorCommand = (typeof OPERATOR_COMMANDS)[number]

export interface OperatorDecision {
  command: OperatorCommand
  /** Who issued it. Recorded for the audit trail, never used to authorise. */
  operatorId: string
  /** For LIMIT — the ceiling the operator imposed, base units. */
  limitAmount?: string
  reason?: string
}

/** Assurance completing — World, active liveness, or both. */
export interface AssuranceProof {
  level: 'WORLD_ONLY' | 'WORLD_PLUS_ACTIVE'
  leaseId: string
  verifiedAt: string
}

// --- signals and queries ---------------------------------------------------

/** An operator answering a pending action from the control plane. */
export const operatorDecisionSignal = defineSignal<[OperatorDecision]>('operatorDecision')

/** Assurance finished — the World/liveness path completing out of band. */
export const assuranceCompletedSignal = defineSignal<[AssuranceProof]>('assuranceCompleted')

/**
 * Trust moved while the workflow was waiting.
 *
 * Section 30.4 requires "live trust change during wait" to be covered: a
 * Substreams event can make an actor materially riskier between the moment a
 * challenge was issued and the moment a human approves it, and approving
 * against the old picture would authorise something nobody actually assessed.
 */
export const trustChangedSignal = defineSignal<[{ band: string; snapshotId: string }]>(
  'trustChanged',
)

/** Inspect a running workflow without disturbing it. */
export const authorizationStateQuery = defineQuery<AuthorizationWorkflowState>('authorizationState')

export interface AuthorizationWorkflowState {
  intentId: string
  actorId: string
  phase: WorkflowPhase
  result: AuthorizationResult | null
  trustBand: string | null
  awaiting: string | null
  operatorDecision: OperatorDecision | null
  assurance: AssuranceProof | null
  /** Every state change, in order. The audit trail section 3.6 requires. */
  history: string[]
}

export const WORKFLOW_PHASES = [
  'EVALUATING',
  'AWAITING_ASSURANCE',
  'AWAITING_OPERATOR',
  'RE_EVALUATING',
  'GRANTING',
  'COMPLETE',
  'TIMED_OUT',
] as const
export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number]

// --- workflow inputs -------------------------------------------------------

export interface AuthorizationWorkflowInput {
  intentId: string
  actorId: string
  actionType: string
  resourceType: string
  resourceId: string
  amount: string | null
  /** Seconds to wait for assurance or an operator before timing out. */
  approvalTimeoutSeconds: number
}

export interface AuthorizationWorkflowOutput {
  intentId: string
  result: AuthorizationResult
  reasonCode: string
  capabilityId: string | null
  trustBand: string | null
  timedOut: boolean
  history: string[]
}

export interface CapabilityLeaseWorkflowInput {
  capabilityId: string
  actorId: string
  actionType: string
  /** Seconds until the lease is re-checked. */
  leaseSeconds: number
  /** How many renewals before the workflow stops rather than looping forever. */
  maxRenewals: number
}

export interface CapabilityLeaseWorkflowOutput {
  capabilityId: string
  renewals: number
  finalAction: 'RENEWED' | 'ATTENUATED' | 'REVOKED'
  history: string[]
}

/** Deterministic workflow id, so a retried start attaches instead of duplicating. */
export function authorizationWorkflowId(intentId: string): string {
  return `authz-${intentId}`
}

export function capabilityLeaseWorkflowId(capabilityId: string): string {
  return `lease-${capabilityId}`
}
