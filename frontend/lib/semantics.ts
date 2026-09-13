/**
 * The one place every status-to-colour mapping in the product lives.
 * Section 1.3 of the frontend spec: every status maps to exactly one of
 * four colours. No component decides its own colour — it reads this map.
 */

export type SemanticColor = 'acid' | 'amber' | 'signal' | 'bolt'

export const TRUST_BAND_COLOR: Record<string, SemanticColor> = {
  VERIFIED_LOW: 'acid',
  ESTABLISHED_LOW: 'acid',
  UNCERTAIN: 'amber',
  HIGH_RISK: 'signal',
  CRITICAL: 'signal',
  INSUFFICIENT_EVIDENCE: 'bolt',
}

export const DECISION_COLOR: Record<string, SemanticColor> = {
  ALLOW: 'acid',
  LIMIT: 'amber',
  CHALLENGE: 'amber',
  REVIEW: 'bolt',
  BLOCK: 'signal',
}

export const EXECUTION_COLOR: Record<string, SemanticColor> = {
  EXECUTED_AS_AUTHORIZED: 'acid',
  BLOCKED_UNENFORCEABLE: 'bolt',
  NOT_EXECUTED: 'bolt',
  FAILED: 'signal',
}

export const INCIDENT_COLOR: Record<string, SemanticColor> = {
  OPEN: 'bolt', // overridden to signal at HIGH/CRITICAL severity — see incidentColor()
  INVESTIGATING: 'amber',
  MITIGATED: 'amber',
  RESOLVED: 'acid',
  FALSE_POSITIVE: 'acid',
}

export const CAPABILITY_COLOR: Record<string, SemanticColor> = {
  ACTIVE: 'acid',
  SUSPENDED: 'amber',
  ATTENUATED_GRANT: 'amber',
  REVOKED: 'signal',
  EXPIRED: 'bolt',
}

export const AGENT_STATUS_COLOR: Record<string, SemanticColor> = {
  DRAFT: 'bolt',
  VERIFYING: 'amber',
  HUMAN_BACKED: 'amber',
  ACTIVE: 'acid',
  RESTRICTED: 'amber',
  FROZEN: 'signal',
  REVOKED: 'signal',
}

export const PAYMENT_COLOR: Record<string, SemanticColor> = {
  SETTLED: 'acid',
  VERIFIED: 'acid',
  REQUIRED: 'bolt',
  DENIED: 'signal',
  INVALID: 'signal',
  FAILED: 'signal',
}

export const SEVERITY_COLOR: Record<string, SemanticColor> = {
  LOW: 'bolt',
  MEDIUM: 'amber',
  HIGH: 'signal',
  CRITICAL: 'signal',
}

/** Incidents recolour to `signal` at HIGH/CRITICAL severity while OPEN — the spec's CH08 rule. */
export function incidentColor(status: string, severity?: string | null): SemanticColor {
  if (status === 'OPEN' && (severity === 'HIGH' || severity === 'CRITICAL')) return 'signal'
  return INCIDENT_COLOR[status] ?? 'bolt'
}

export type BadgeKind = 'band' | 'decision' | 'execution' | 'incident' | 'capability' | 'agentStatus' | 'payment' | 'severity'

const MAPS: Record<Exclude<BadgeKind, 'incident'>, Record<string, SemanticColor>> = {
  band: TRUST_BAND_COLOR,
  decision: DECISION_COLOR,
  execution: EXECUTION_COLOR,
  capability: CAPABILITY_COLOR,
  agentStatus: AGENT_STATUS_COLOR,
  payment: PAYMENT_COLOR,
  severity: SEVERITY_COLOR,
}

export function semanticColor(kind: BadgeKind, value: string, severity?: string | null): SemanticColor {
  if (kind === 'incident') return incidentColor(value, severity)
  return MAPS[kind][value] ?? 'bolt'
}

/** Tailwind class fragments for each semantic color — text, border, bg-dot. */
export const COLOR_CLASSES: Record<SemanticColor, { text: string; border: string; dot: string; bgSoft: string }> = {
  acid: { text: 'text-acid', border: 'border-acid', dot: 'bg-acid', bgSoft: 'bg-acid/10' },
  amber: { text: 'text-amber', border: 'border-amber', dot: 'bg-amber', bgSoft: 'bg-amber/10' },
  signal: { text: 'text-signal', border: 'border-signal', dot: 'bg-signal', bgSoft: 'bg-signal/10' },
  bolt: { text: 'text-bolt', border: 'border-bolt', dot: 'bg-bolt', bgSoft: 'bg-bolt/10' },
}
