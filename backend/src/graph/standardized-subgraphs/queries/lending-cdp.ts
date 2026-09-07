/**
 * Schema family: lending-cdp (Messari Lending/CDP schema v3.1.0).
 *
 * ONE module for the whole family — Aave, Compound, MakerDAO, Spark, Venus and
 * dozens more across Ethereum, Polygon, Arbitrum, Avalanche, BSC, Optimism and
 * Base all answer these exact queries. There is deliberately no protocol name
 * anywhere in this file.
 *
 * Entity names confirmed in Backend-Suganthan.md Section 0.3 (from The Graph's
 * own blog post on this schema) and re-checked against the live schema:
 *   lendingProtocols, markets, accounts, positions,
 *   deposits, borrows, repays, withdraws, liquidates, flashloans,
 *   financialsDailySnapshots, marketDailySnapshots, usageMetricsDailySnapshots
 */
import { queryFamily } from '../client.js'
import { getDeploymentsForFamily } from '../deployment-registry.js'
import type { DeploymentEntry, ProvenancedResult } from '../types.js'

export const SCHEMA_FAMILY = 'lending-cdp' as const

/** A wallet's lending footprint on one deployment. */
export interface LendingAccountActivity {
  account: {
    id: string
    positionCount?: number
    openPositionCount?: number
    depositCount?: number
    borrowCount?: number
    withdrawCount?: number
    repayCount?: number
    liquidateCount?: number
  } | null
  deposits: LendingEvent[]
  borrows: LendingEvent[]
  repays: LendingEvent[]
  withdraws: LendingEvent[]
}

export interface LendingEvent {
  id: string
  hash: string
  logIndex: number
  blockNumber: string
  timestamp: string
  amount: string
  amountUSD?: string | null
  account: { id: string }
  market: { id: string; name?: string | null }
}

const EVENT_FIELDS = `
  id
  hash
  logIndex
  blockNumber
  timestamp
  amount
  amountUSD
  account { id }
  market { id name }
`

/**
 * Every lending action a wallet took on one deployment.
 *
 * Feeds two Phase 7 features: SHARED_COUNTERPARTY (which markets the wallet
 * touched) and PROTOCOL_BEHAVIOR_SIMILARITY (the ordered sequence of event
 * types — deposit, borrow, repay… — that a coordinated cluster tends to repeat
 * identically).
 */
export const ACCOUNT_ACTIVITY_QUERY = `
query AccountActivity($account: String!, $first: Int!) {
  account(id: $account) {
    id
    positionCount
    openPositionCount
    depositCount
    borrowCount
    withdrawCount
    repayCount
    liquidateCount
  }
  deposits(where: { account: $account }, first: $first, orderBy: timestamp, orderDirection: asc) {${EVENT_FIELDS}}
  borrows(where: { account: $account }, first: $first, orderBy: timestamp, orderDirection: asc) {${EVENT_FIELDS}}
  repays(where: { account: $account }, first: $first, orderBy: timestamp, orderDirection: asc) {${EVENT_FIELDS}}
  withdraws(where: { account: $account }, first: $first, orderBy: timestamp, orderDirection: asc) {${EVENT_FIELDS}}
}`

/**
 * Runs the account-activity query across EVERY enabled lending deployment.
 *
 * The Phase 4 acceptance test lives here: two deployment ids tagged
 * `lending-cdp` run through this one function with no protocol branch.
 */
export async function getAccountActivityAcrossFamily(
  account: string,
  opts: { first?: number; deployments?: DeploymentEntry[] } = {},
): Promise<
  Array<
    { entry: DeploymentEntry } & (
      { result: ProvenancedResult<LendingAccountActivity> } | { error: Error }
    )
  >
> {
  const deployments = opts.deployments ?? (await getDeploymentsForFamily(SCHEMA_FAMILY))
  return queryFamily<LendingAccountActivity>(deployments, ACCOUNT_ACTIVITY_QUERY, {
    // Subgraph string comparisons are lower-cased addresses.
    account: account.toLowerCase(),
    first: opts.first ?? 100,
  })
}
