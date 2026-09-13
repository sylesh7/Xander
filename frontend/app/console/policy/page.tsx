import { POLICY_NAME, POLICY_RULES, POLICY_VERSION, type PolicyRule } from '@/lib/policyRules'

function group(rules: readonly PolicyRule[], min: number, max: number) {
  return rules.filter((r) => r.priority >= min && r.priority <= max)
}

function RuleRow({ rule, highlight }: { rule: PolicyRule; highlight?: boolean }) {
  const conditions: string[] = []
  if (rule.trustBands) conditions.push(`band ∈ {${rule.trustBands.join(', ')}}`)
  if (rule.minAmount) conditions.push(`amount ≥ ${rule.minAmount}`)
  if (rule.maxAmount) conditions.push(`amount ≤ ${rule.maxAmount}`)
  if (rule.maxCoordinationRisk != null) conditions.push(`coordinationRisk ≤ ${rule.maxCoordinationRisk}`)
  if (rule.minBehaviorIntegrity != null) conditions.push(`behaviorIntegrity ≥ ${rule.minBehaviorIntegrity}`)
  if (rule.requiresLiveAssurance === false) conditions.push('no live assurance')
  if (rule.requiresLiveAssurance === true) conditions.push('requires live assurance')

  const limits: string[] = []
  if (rule.limitAmount) limits.push(`limit ${rule.limitAmount}`)
  if (rule.limitFrequency) limits.push(`${rule.limitFrequency}/${rule.limitWindowSeconds}s`)
  if (rule.capabilityTtlSeconds) limits.push(`ttl ${rule.capabilityTtlSeconds}s`)

  return (
    <tr className={`border-b border-rule ${highlight ? 'bg-paper-2' : ''}`}>
      <td className="px-3 py-2 font-tele text-[0.78rem] tabular-nums text-faint">{rule.priority}</td>
      <td className="px-3 py-2 font-tele text-[0.8rem] text-ink">{rule.name}</td>
      <td className="px-3 py-2 font-tele text-[0.76rem] text-dim uppercase">{rule.actionType ?? 'any'}</td>
      <td className="px-3 py-2 font-tele text-[0.72rem] text-dim">{conditions.join(' · ') || '—'}</td>
      <td className="px-3 py-2 font-tele text-[0.76rem] font-bold uppercase text-ink">{rule.effect}</td>
      <td className="px-3 py-2 font-tele text-[0.7rem] text-faint">{limits.join(' · ') || '—'}</td>
    </tr>
  )
}

function Group({ title, rules }: { title: string; rules: PolicyRule[] }) {
  if (rules.length === 0) return null
  return (
    <div className="mb-6">
      <h2 className="mb-2 font-tele text-[0.68rem] font-bold tracking-[0.18em] text-faint uppercase">{title}</h2>
      <div className="overflow-x-auto border border-rule">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-rule">
              {['Priority', 'Name', 'Action', 'Conditions', 'Effect', 'Limits'].map((h) => (
                <th key={h} className="px-3 py-2 font-tele text-[10px] font-bold tracking-widest text-faint uppercase">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <RuleRow key={r.priority} rule={r} highlight={r.priority >= 52 && r.priority <= 56} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function PolicyPage() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <h1 className="mb-1 font-shout text-[2.2rem] leading-none uppercase">Policy</h1>
      <p className="mb-1 font-tele text-[0.78rem] tracking-[0.08em] text-dim uppercase">
        {POLICY_NAME} · {POLICY_VERSION}
      </p>
      <p className="mb-6 max-w-[70ch] text-[0.86rem] text-dim">
        Ordering is the policy. First match by ascending priority wins. This table is a static mirror of{' '}
        <code>backend/prisma/seed-data/policy-rules.ts</code> — no endpoint exposes it live yet, so this can drift if
        the backend file changes without this one being re-copied.
      </p>

      <Group title="10–29 · Hard stops — nothing below can override these" rules={group(POLICY_RULES, 10, 29)} />
      <Group title="30–49 · High-value actions" rules={group(POLICY_RULES, 30, 49)} />
      <Group title="50–59 · API & commerce (52–56 is the x402 ladder, highlighted)" rules={group(POLICY_RULES, 50, 59)} />
      <Group title="60–69 · Claims — the V1 vertical, now one action among many" rules={group(POLICY_RULES, 60, 69)} />
      <Group title="90+ · Catch-alls" rules={group(POLICY_RULES, 90, 999)} />
    </div>
  )
}
