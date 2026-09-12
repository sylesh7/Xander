/**
 * `npm run check:incident` — Phase 10, sections 14.1 / 15 / 23, end to end.
 *
 * Real Postgres, real Temporal server, real capability enforcement. Proves the
 * acceptance condition: a live anomaly produces a traceable investigation that
 * identifies supporting AND contradicting evidence and feeds a deterministic
 * policy decision.
 *
 * The case is built deliberately as the ARBITRUM SHAPE — wallets sharing a
 * labelled exchange hot wallet, acting months apart, on different protocols.
 * A confirmation-biased investigator calls that a ring. The counter-evidence
 * search is supposed to argue the other side, and this script checks that it
 * actually does.
 */
import { randomBytes } from 'node:crypto'
import { prisma } from '../src/lib/prisma.js'
import { env } from '../src/config/env.js'
import { resolveActorForWallet } from '../src/actor/actor-resolver.js'
import { grantCapability } from '../src/capabilities/capability-service.js'
import { searchCounterEvidence } from '../src/incidents/counter-evidence.js'
import {
  decideIncident,
  openIncident,
  resolveIncident,
  signalInvestigationComplete,
  startIncidentWorkflow,
} from '../src/incidents/incident-service.js'
import { isTemporalEnabled, getTemporalClient } from '../src/workflow/temporal-client.js'
import { incidentWorkflowId, incidentStateQuery } from '../src/workflow/shared.js'

const ok = (label: string, detail: string) => console.log(`  [OK]   ${label.padEnd(32)} ${detail}`)
const bad = (label: string, detail: string) => {
  console.log(`  [FAIL] ${label.padEnd(32)} ${detail}`)
  process.exitCode = 1
}

const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`

async function insertEvidence(args: {
  wallet: string
  counterparty: string
  chain: string
  count: number
  protocol: string
  startMsAgo: number
  spacingMs: number
}): Promise<void> {
  const now = Date.now()
  await prisma.evidenceEvent.createMany({
    data: Array.from({ length: args.count }, (_, i) => ({
      chain: args.chain,
      wallet: args.wallet.toLowerCase(),
      counterparty: args.counterparty.toLowerCase(),
      eventType: 'transfer',
      protocol: args.protocol,
      protocolType: 'lending-cdp',
      amount: '1000000000000000000',
      timestamp: new Date(now - args.startMsAgo + i * args.spacingMs),
      blockNumber: BigInt(9_000_000 + i),
      transactionHash: `0xchk${randomBytes(8).toString('hex')}${i}`,
      sourceType: 'token-api',
      sourceId: `0xchk${randomBytes(8).toString('hex')}${i}-0`,
      deploymentId: null,
    })),
    skipDuplicates: true,
  })
}

async function main(): Promise<void> {
  console.log('\nIncident response — end to end')
  console.log(`  temporal: ${env.TEMPORAL_ADDRESS} (${env.TEMPORAL_NAMESPACE})\n`)

  const exchange = await prisma.knownFunderAddress.findFirst({ where: { category: 'EXCHANGE' } })
  if (!exchange) {
    bad('known funders seeded', 'no EXCHANGE label found — run npm run db:seed')
    await prisma.$disconnect()
    return
  }
  ok('labelled funder', `${exchange.label} on ${exchange.chain} (${exchange.confidence})`)

  // --- 1. two wallets that LOOK coordinated but are not --------------------
  const walletA = randomWallet()
  const walletB = randomWallet()
  const actorA = await resolveActorForWallet(walletA)
  const actorB = await resolveActorForWallet(walletB)

  await insertEvidence({
    wallet: walletA,
    counterparty: exchange.address,
    chain: exchange.chain,
    count: 15,
    protocol: 'aave-v3',
    startMsAgo: 300 * 86_400_000,
    spacingMs: 7 * 86_400_000,
  })
  await insertEvidence({
    wallet: walletB,
    counterparty: exchange.address,
    chain: exchange.chain,
    count: 15,
    protocol: 'uniswap-v3',
    startMsAgo: 20 * 86_400_000,
    spacingMs: 86_400_000,
  })
  ok('evidence written', '30 events, shared exchange funder, divergent timing and protocols')

  const capability = await grantCapability({
    actorId: actorA.id,
    actionType: 'TRADE',
    resourceScope: 'incident-check',
    limits: {
      amountLimit: '1000000',
      frequencyLimit: 20,
      frequencyWindowSeconds: 86_400,
      allowedTargets: [],
      expiresAt: null,
    },
    attenuated: false,
  })
  ok('capability granted', `${capability.id} ACTIVE`)

  // --- 2. counter-evidence must argue the other side -----------------------
  const counter = await searchCounterEvidence({ wallets: [walletA, walletB] })
  const kinds = counter.findings.map((f) => f.kind)
  if (kinds.includes('SHARED_FUNDER_IS_LABELLED')) {
    ok('found the Arbitrum defence', 'shared funder is a labelled exchange')
  } else {
    bad('found the Arbitrum defence', `only found: ${kinds.join(', ') || 'nothing'}`)
  }
  if (kinds.includes('ACTIVITY_IS_NOT_SYNCHRONISED')) ok('found divergent timing', 'wallets act months apart')
  else bad('found divergent timing', `only found: ${kinds.join(', ')}`)
  if (kinds.includes('PROTOCOL_USAGE_DIVERGES')) ok('found divergent protocols', 'aave-v3 vs uniswap-v3')
  else bad('found divergent protocols', `only found: ${kinds.join(', ')}`)
  ok('doubt', `${counter.doubt?.toFixed(2)} — ${counter.summary}`)

  // --- 3. the incident: containment happens BEFORE investigation -----------
  const incident = await openIncident({
    actorId: actorA.id,
    type: 'COORDINATION_DETECTED',
    severity: 'HIGH',
    source: 'check:incident',
    detail: 'shared funder with a second wallet',
  })
  const contained = await prisma.capability.findUniqueOrThrow({ where: { id: capability.id } })
  if (contained.status === 'SUSPENDED') {
    ok('CONTAINED BEFORE INVESTIGATING', `capability is ${contained.status}`)
  } else {
    bad('CONTAINED BEFORE INVESTIGATING', `capability is ${contained.status}, expected SUSPENDED`)
  }

  // --- 4. the durable workflow ---------------------------------------------
  if (!isTemporalEnabled()) {
    bad('incident workflow', 'Temporal is disabled')
  } else {
    const started = await startIncidentWorkflow(incident.id, { investigationTimeoutSeconds: 20 })
    if (started.started) ok('incident workflow started', started.workflowId ?? '')
    else bad('incident workflow started', started.detail)

    if (started.started) {
      const client = await getTemporalClient()
      const handle = client.workflow.getHandle(incidentWorkflowId(incident.id))

      // Give the deterministic investigation activity time to land.
      let state = await handle.query(incidentStateQuery)
      for (let i = 0; i < 30 && state.investigationId === null; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        state = await handle.query(incidentStateQuery)
      }
      if (state.investigationId) ok('workflow investigated', `investigation ${state.investigationId}`)
      else bad('workflow investigated', `stuck in phase ${state.phase}`)

      // --- 5. THE SECTION 15.3 TEST, through the real workflow -------------
      // An investigator that says ALLOW on a HIGH-severity incident must be
      // overruled. This is the authorization-bypass case.
      const signalled = await signalInvestigationComplete({
        incidentId: incident.id,
        investigationId: state.investigationId ?? 'unknown',
        recommendedAction: 'ALLOW',
        confidence: 0.9,
        summary: 'the investigator argues this is benign',
      })
      if (signalled.signalled) ok('AI finding delivered', 'recommended ALLOW')
      else bad('AI finding delivered', signalled.detail)

      const output = await handle.result()
      if (output.aiAttemptedToWiden) {
        ok('AI DE-ESCALATION REFUSED', `applied ${output.mitigation}, not ALLOW`)
      } else {
        bad('AI DE-ESCALATION REFUSED', `aiAttemptedToWiden was false; mitigation ${output.mitigation}`)
      }
      if (output.mitigation === 'RESTRICT') ok('deterministic decision stood', 'HIGH -> REVIEW -> RESTRICT')
      else bad('deterministic decision stood', `mitigation was ${output.mitigation}`)
    }
  }

  // --- 6. the investigation is traceable -----------------------------------
  const refreshed = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })
  if (refreshed.investigationId) {
    const investigation = await prisma.investigation.findUniqueOrThrow({
      where: { id: refreshed.investigationId },
    })
    const supporting = investigation.supportingEvidenceIds.length
    const contradicting = investigation.contradictingEvidenceIds.length
    if (supporting > 0 && contradicting > 0) {
      ok('BOTH SIDES RECORDED', `${supporting} supporting, ${contradicting} contradicting`)
    } else {
      bad('BOTH SIDES RECORDED', `${supporting} supporting, ${contradicting} contradicting`)
    }
    // Every cited row must be a real evidence row, not an invented id.
    const real = await prisma.evidenceEvent.count({
      where: { id: { in: investigation.contradictingEvidenceIds.slice(0, 50) } },
    })
    if (real === investigation.contradictingEvidenceIds.slice(0, 50).length) {
      ok('citations are real rows', `${real} verified against EvidenceEvent`)
    } else {
      bad('citations are real rows', `${real} of ${contradicting} resolve`)
    }
    if (investigation.recommendedAction === 'ALLOW') {
      ok('overruled recommendation kept', 'recorded as ALLOW, not erased')
    } else {
      bad('overruled recommendation kept', `recorded ${investigation.recommendedAction}`)
    }
  } else {
    bad('investigation linked', 'incident has no investigationId')
  }

  // --- 7. closing it, and restoring on a false positive --------------------
  const decided = await decideIncident({ incidentId: incident.id, aiRecommendation: null }).catch(
    () => null,
  )
  if (decided === null) ok('already mitigated', 'workflow had applied the decision')

  const closed = await resolveIncident({
    incidentId: incident.id,
    status: 'FALSE_POSITIVE',
    rootCause: 'shared funder is a labelled exchange; wallets are independent',
    restore: true,
  })
  ok('closed as FALSE_POSITIVE', `${closed.restored} capability restored`)
  const restored = await prisma.capability.findUniqueOrThrow({ where: { id: capability.id } })
  if (restored.status === 'ACTIVE') ok('authority restored', 'capability is ACTIVE again')
  else bad('authority restored', `capability is ${restored.status}`)

  // A closed incident is terminal.
  const reopened = await resolveIncident({
    incidentId: incident.id,
    status: 'RESOLVED',
    rootCause: 'changed my mind',
  }).catch((err: unknown) => err)
  if (reopened instanceof Error) ok('closed incident is terminal', 'reopening refused')
  else bad('closed incident is terminal', 'a closed incident was reopened')

  // --- cleanup --------------------------------------------------------------
  await prisma.evidenceEvent.deleteMany({
    where: { wallet: { in: [walletA.toLowerCase(), walletB.toLowerCase()] } },
  })
  await prisma.incident.deleteMany({ where: { actorId: { in: [actorA.id, actorB.id] } } })
  await prisma.actor.deleteMany({ where: { id: { in: [actorA.id, actorB.id] } } })

  console.log(
    process.exitCode
      ? '\nIncident check FAILED.\n'
      : '\nIncident response proven: contained first, both sides investigated, AI overruled by policy.\n',
  )
  await prisma.$disconnect()
}

main().catch(async (err: unknown) => {
  console.error('\ncheck:incident failed\n', err)
  process.exitCode = 1
  await prisma.$disconnect()
})
