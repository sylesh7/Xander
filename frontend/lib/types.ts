/**
 * Shapes lifted directly from `docs/backendwiring.md` and verified against the
 * live backend. Kept intentionally loose (optional/nullable where the wiring
 * doc shows `| null`) rather than re-guessing a stricter shape.
 */

export type DimensionState = 'KNOWN' | 'UNKNOWN' | 'NOT_APPLICABLE'

export interface TrustDimension {
  value: number | null
  state: DimensionState
  basis: string
}

export interface TrustVector {
  behaviorIntegrity: TrustDimension
  coordinationRisk: TrustDimension
  historyStrength: TrustDimension
  humanAssurance: TrustDimension
  agentReputation: TrustDimension
  evidenceFreshness: TrustDimension
  investigationConfidence: TrustDimension
}

export const TRUST_DIMENSIONS: { key: keyof TrustVector; label: string }[] = [
  { key: 'behaviorIntegrity', label: 'Behavior integrity' },
  { key: 'coordinationRisk', label: 'Coordination risk' },
  { key: 'historyStrength', label: 'History strength' },
  { key: 'humanAssurance', label: 'Human assurance' },
  { key: 'agentReputation', label: 'Agent reputation' },
  { key: 'evidenceFreshness', label: 'Evidence freshness' },
  { key: 'investigationConfidence', label: 'Investigation confidence' },
]

export type TrustBand =
  | 'VERIFIED_LOW'
  | 'ESTABLISHED_LOW'
  | 'UNCERTAIN'
  | 'HIGH_RISK'
  | 'CRITICAL'
  | 'INSUFFICIENT_EVIDENCE'

export interface DriftSignal {
  kind: string
  positive: boolean
  weight: number
  detail: string
  source: string
  createdAt?: string
}

export interface TrustDrift {
  signals: DriftSignal[]
  peakMagnitude: number
  hadBaseline: boolean
}

export interface ActorIdentity {
  kind: string
  externalId: string
  status: string
  source: string
  verifiedAt: string | null
}

export interface ActorView {
  id: string
  actorType: 'WALLET' | 'AGENT' | 'ORGANIZATION' | 'HUMAN'
  status: string
  displayName: string | null
  identities: ActorIdentity[]
  createdAt: string
  updatedAt: string
}

export interface TrustContextResponse {
  actorId: string
  snapshotId: string
  band: TrustBand
  vector: TrustVector
  drift: TrustDrift
  evidenceIds: string[]
  engineVersion: string
  policyVersion: string
  cached: boolean
}

export interface TrustSnapshotSummary {
  snapshotId: string
  band: TrustBand
  engineVersion: string
  policyVersion: string
  createdAt: string
}

export interface TrustHistoryResponse {
  actorId: string
  snapshots: TrustSnapshotSummary[]
  signals: DriftSignal[]
  balance: unknown
}

export interface CapabilityRow {
  id: string
  capabilityType: 'GRANT' | 'ATTENUATED_GRANT'
  actionType: string
  resourceScope: string | null
  chainScope: number | null
  amountLimit: string | null
  frequencyLimit: number | null
  frequencyWindowSeconds: number | null
  allowedTargets: string[]
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'SUSPENDED'
  live: boolean
  expiresAt: string | null
  sourceDecisionId: string | null
  createdAt: string
}

export interface CapabilitiesResponse {
  actorId: string
  assurance: { hasLiveLease: boolean; level: string | null; expiresAt: string | null }
  capabilities: CapabilityRow[]
}

export interface EnforcementBoundary {
  adapter: string
  actionType: string
  enforceable: boolean | null
  detail: string
}

export interface EnforcementResponse {
  actorId: string
  boundaries: EnforcementBoundary[]
}

export interface RiskFeature {
  name: string
  value: number
}

export interface EvidenceSource {
  type: string
  deployment: string | null
  block: string | null
}

export interface WalletRiskResponse {
  wallet: string
  cached: boolean
  clusterId: string | null
  riskScore: number
  confidence: string
  policyVersion: string
  features: RiskFeature[]
  sources: EvidenceSource[]
  status: string
}

export interface EvidenceRow {
  id: string
  chain: string
  wallet: string
  counterparty: string | null
  eventType: string
  protocol: string | null
  protocolType: string | null
  amount: string | null
  timestamp: string
  blockNumber: string
  transactionHash: string | null
  sourceType: string
  deploymentId: string | null
}

export interface ClusterEvidenceResponse {
  clusterId: string
  walletCount: number
  eventCount: number
  events: EvidenceRow[]
}

export interface ReadinessDependency {
  dependency: string
  up: boolean
  degradedBehaviour: string | null
  detail: string
}

export interface ReadinessResponse {
  ready: boolean
  canAuthorize: boolean
  dependencies: ReadinessDependency[]
  summary: string
}

export interface HealthResponse {
  ok: boolean
  provenance: {
    tokenApi?: { lastSuccessAt: string | null; ageSeconds: number | null; stale: boolean }
    deployments?: { protocol: string; chain: string; schemaFamily: string; deploymentId: string; lastSeenBlock: string | null; lastSeenAt: string | null }[]
    substreams?: unknown[]
  } | null
}

export interface IncidentRow {
  id: string
  actorId: string | null
  clusterId: string | null
  campaignId: string | null
  type: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  status: string
  openedAt: string
  closedAt: string | null
  rootCause: string | null
  investigationId: string | null
  source: string
  detail: string | null
  mitigation: string | null
  mitigationReason: string | null
  updatedAt: string
}

export interface DecisionView {
  decisionId: string
  result: 'ALLOW' | 'LIMIT' | 'CHALLENGE' | 'REVIEW' | 'BLOCK'
  reasonCode: string
  reasonSummary: string
  requiredAssurance: string | null
  policyVersion: string
  riskScore: number | null
  clusterId: string | null
  confidence: string
  evidenceIds: string[]
  createdAt: string
}

export interface IntentView {
  intentId: string
  actorId: string
  status: string
  actionType: string
  resourceType: string
  resourceId: string
  parametersHash: string
  idempotencyKey: string | null
  expiresAt: string
  createdAt: string
  receiptId: string | null
  replayed: boolean
  decision: DecisionView | null
}

export interface AgentRow {
  id: string
  actorId: string
  name: string
  status: string
  agentUri: string | null
  erc8004AgentId: string | null
  worldAgentId: string | null
  ensName: string | null
  ensTokenId: string | null
  worldChallengeId: string | null
  assuranceLeaseId: string | null
  configurationJson: unknown
  createdAt: string
  updatedAt: string
}

export type ClaimDecision = 'ALLOW' | 'CHALLENGE' | 'BLOCK' | 'PENDING_REVIEW'

export interface IdKitConfig {
  app_id: string
  rp_id: string
  action: string
  preset: string
  signal: string
  allow_legacy_proofs: true
}

export interface ScreenClaimResponse {
  claimId: string
  decision: ClaimDecision
  clusterId: string | null
  riskScore: number
  requiredAssurance: 'SELFIE_CHECK' | null
  evidenceReceiptId: string | null
  verificationChallengeId: string | null
  idkit: IdKitConfig | null
  reason: string
  cached: boolean
}

export interface RpSignatureResponse {
  sig: string
  nonce: string
  created_at: number
  expires_at: number
}

export interface WorldVerifyResponse {
  status: 'PASSED' | 'FAILED' | 'RETRYABLE'
  challengeId: string
  reason: string
}

export interface WorldChallengeReissueResponse {
  claimId: string
  challengeId: string
  reused: boolean
  idkit: IdKitConfig | null
}

export interface LivenessStartResponse {
  challengeId: string
  nonce: string
  target: number
  instruction: string
  expiresAt: string
}

export interface LivenessFrame {
  tMs: number
  landmarks: { x: number; y: number; z?: number }[]
}

export interface LivenessCompleteRequest {
  challengeId: string
  nonce: string
  sessionBinding: string
  cvVersion?: string
  frames: LivenessFrame[]
}

export interface LivenessCompleteResponse {
  challengeId: string
  passed: boolean
  reason?: string | null
  failureCode?: string | null
}

export interface EnsState {
  fqdn: string | null
  registered: boolean
  expiresAt: string | null
  onChainActions: string[]
}

/** Field name differs per endpoint (minted on create, mirrored on verify, revokedOnChain on freeze/revoke). */
export interface EnsOutcome {
  minted?: boolean
  mirrored?: boolean
  revokedOnChain?: boolean
  skipReason: string | null
  txHash: string | null
  detail: string
}

export interface LivenessChallengeRow {
  id: string
  agentId: string | null
  actorId: string
  challengeType: string
  target: number
  nonce: string
  sessionBinding: string
  expiresAt: string
  status: 'ISSUED' | 'PASSED' | 'FAILED' | 'EXPIRED'
  consumedAt: string | null
  failureReason: string | null
  cvVersion: string | null
  createdAt: string
  resolvedAt: string | null
}

export interface AgentDetail extends AgentRow {
  challenges: LivenessChallengeRow[]
  ens: EnsState | null
}

export interface FreezeResult {
  agentId: string
  status: string
  capabilitiesSuspended: number
  ens: EnsOutcome
}

export interface UnfreezeResult {
  agentId: string
  status: string
}

export interface RevokeResult {
  agentId: string
  status: string
  ens: EnsOutcome
}

export interface Erc8004LinkResult {
  agentId: string
  erc8004: { agentId: string; owner: string; agentUri: string | null; feedbackCount: number; validationCount: number }
  agentReputation: number | null
  basis: string
}

/** Chain explorers keyed by numeric chain id — never hardcode which one. */
export const CHAIN_EXPLORERS: Record<number, { name: string; txBase: string }> = {
  11155111: { name: 'Sepolia', txBase: 'https://sepolia.etherscan.io/tx/' },
  84532: { name: 'Base Sepolia', txBase: 'https://sepolia.basescan.org/tx/' },
}

/** ENS and ERC-8004 are documented as Sepolia-only — a real constant here, not a hardcode-by-guess. */
export const ENS_CHAIN_ID = 11155111

export const ACTION_TYPES = [
  'CLAIM',
  'VOTE',
  'MINT',
  'TRADE',
  'BORROW',
  'TRANSFER',
  'API_REQUEST',
  'X402_PAYMENT',
  'AGENT_DELEGATION',
] as const

export interface CreateAgentResponse {
  agentId: string
  actorId: string
  name: string
  status: string
  verification: { world: string; activeLiveness: string }
  ens: EnsOutcome & { name: string | null }
}

export interface X402PaymentRequirements {
  scheme: string
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra?: { name?: string; version?: string; [k: string]: unknown }
}

export interface X402Info {
  x402Version: number
  resource: string
  accepts: X402PaymentRequirements[]
  facilitator: { supported: boolean; detail: string }
}

export interface X402PaymentRow {
  id: string
  status: 'REQUIRED' | 'DENIED' | 'INVALID' | 'VERIFIED' | 'SETTLED' | 'FAILED'
  reasonCode: string | null
  trustBand: string | null
  amount: string | null
  network: string | null
  transaction: string | null
  errorReason: string | null
  createdAt: string
  settledAt: string | null
}

export interface InvestigationFinding {
  kind: 'SHARED_FUNDER_IS_LABELLED' | 'ACTIVITY_IS_NOT_SYNCHRONISED' | 'PROTOCOL_USAGE_DIVERGES' | 'INDEPENDENT_PRIOR_HISTORY'
  detail: string
  weight: number
  evidenceIds: string[]
}

export interface CounterEvidence {
  wallets: string[]
  findings: InvestigationFinding[]
  consideredEvidenceIds: string[]
  doubt: number | null
  summary: string
}

export interface InvestigateResult {
  incidentId: string
  investigationId: string
  counterEvidence: CounterEvidence
}

export interface InvestigationRow {
  id: string
  clusterId: string
  wallets: string[]
  status: 'RUNNING' | 'COMPLETE' | 'PARTIAL' | 'FAILED'
  summary: string | null
  toolCalls: number
  model: string | null
  createdAt: string
  completedAt: string | null
  incidentId: string | null
  hypothesis: string | null
  supportingEvidenceIds: string[]
  contradictingEvidenceIds: string[]
  confidence: number | null
  recommendedAction: 'ALLOW' | 'LIMIT' | 'REVIEW' | 'BLOCK' | null
}

export interface IncidentDetailResponse {
  incident: IncidentRow
  investigation: InvestigationRow | null
}

export interface MitigateResult {
  incident: IncidentRow
  capabilitiesAffected: number
  reconciliation: { action: string; aiChangedOutcome: boolean; aiAttemptedToWiden: boolean; reason: string }
}

export interface ResolveResult {
  incident: IncidentRow
  restored: number
}

export interface OpenIncidentResult {
  incident: IncidentRow
  workflow: { started: boolean; workflowId: string; detail: string } | null
}

export interface ExecuteResult {
  intentId: string
  status: 'EXECUTED_AS_AUTHORIZED' | 'BLOCKED_UNENFORCEABLE' | 'FAILED' | 'NOT_EXECUTED'
  executed: boolean
  reason: string
  adapters: string[]
  capabilityId: string | null
  txHash: string | null
  receiptId: string | null
}

export interface PendingAction {
  id: string
  subjectType: 'INTENT' | 'INCIDENT' | 'AGENT'
  subjectId: string
  summary: string
  allowed: string[]
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  bindingHash: string
  requiresStepUp: boolean
  expiresAt: string
}

export interface ControlSession {
  token: string
  sessionId: string
  expiresAt: string
}

export interface ControlAgentRow {
  id: string
  name: string
  status: string
  ensName: string | null
  actorId: string
  updatedAt: string
}

export interface ControlAgentView {
  agent: { id: string; name: string; status: string; ensName: string | null; erc8004AgentId: string | null }
  trust: { band: TrustBand; snapshotId: string; at: string } | null
  assurance: { level: string; expiresAt: string } | null
  capabilities: { id: string; actionType: string; status: string; amountLimit: string | null; expiresAt: string | null }[]
  openIncidents: { id: string; type: string; severity: string; status: string; openedAt: string }[]
}

export interface DecisionCommandResult {
  actionId: string
  command: string
  applied: boolean
  workflowSignalled: boolean
  detail: string
}

export interface AuditEntry {
  id: string
  operatorId: string
  sessionId: string
  deviceId: string
  action: string
  subject: string
  outcome: string
  reason: string | null
  nonce: string
  ip: string | null
  createdAt: string
}

export interface VerifyAgentResponse {
  agentId: string
  status: string
  assurance: { leaseId: string; level: string; expiresAt: string }
  capabilityIds: string[]
  ens: EnsOutcome
}
