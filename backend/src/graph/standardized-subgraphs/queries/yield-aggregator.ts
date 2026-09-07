/**
 * Schema family: yield-aggregator (Messari Yield Aggregator schema v1.3.1).
 *
 * The second family Backend-Suganthan.md Phase 4 flagged as unverified. These
 * entity names were read off the live Messari `schema-yield.graphql` on
 * 2026-09-07. Every top-level entity in that schema:
 *
 *   Token, RewardToken, VaultFee, YieldAggregator,
 *   UsageMetricsDailySnapshot, UsageMetricsHourlySnapshot,
 *   FinancialsDailySnapshot, Vault, VaultDailySnapshot, VaultHourlySnapshot,
 *   Deposit, Withdraw, Account, ActiveAccount
 *
 * Two differences from the other families worth knowing: the pool-equivalent is
 * `vaults`, and there is NO swap or borrow entity — a yield aggregator only has
 * deposits and withdraws. Anything reaching for `swaps` here would get a schema
 * error, which is the concrete reason this is a separate module.
 */
import { queryFamily } from '../client.js'
import { getDeploymentsForFamily } from '../deployment-registry.js'
import type { DeploymentEntry, ProvenancedResult } from '../types.js'

export const SCHEMA_FAMILY = 'yield-aggregator' as const

export interface VaultEvent {
  id: string
  hash: string
  logIndex: number
  blockNumber: string
  timestamp: string
  amount: string
  amountUSD?: string | null
  account: { id: string }
  vault: { id: string; name?: string | null; symbol?: string | null }
}

export interface YieldAccountActivity {
  account: {
    id: string
    depositCount?: number
    withdrawCount?: number
  } | null
  deposits: VaultEvent[]
  withdraws: VaultEvent[]
}

const VAULT_EVENT_FIELDS = `
  id
  hash
  logIndex
  blockNumber
  timestamp
  amount
  amountUSD
  account { id }
  vault { id name symbol }
`

/**
 * A wallet's vault footprint on one deployment.
 *
 * Farming the same vaults on the same schedule is a common coordinated-claim
 * pattern, so shared vault ids feed SHARED_COUNTERPARTY and the deposit/withdraw
 * ordering feeds PROTOCOL_BEHAVIOR_SIMILARITY.
 */
export const ACCOUNT_ACTIVITY_QUERY = `
query YieldAccountActivity($account: String!, $first: Int!) {
  account(id: $account) {
    id
    depositCount
    withdrawCount
  }
  deposits(where: { account: $account }, first: $first, orderBy: timestamp, orderDirection: asc) {${VAULT_EVENT_FIELDS}}
  withdraws(where: { account: $account }, first: $first, orderBy: timestamp, orderDirection: asc) {${VAULT_EVENT_FIELDS}}
}`

export async function getAccountActivityAcrossFamily(
  account: string,
  opts: { first?: number; deployments?: DeploymentEntry[] } = {},
): Promise<
  Array<
    { entry: DeploymentEntry } & (
      { result: ProvenancedResult<YieldAccountActivity> } | { error: Error }
    )
  >
> {
  const deployments = opts.deployments ?? (await getDeploymentsForFamily(SCHEMA_FAMILY))
  return queryFamily<YieldAccountActivity>(deployments, ACCOUNT_ACTIVITY_QUERY, {
    account: account.toLowerCase(),
    first: opts.first ?? 100,
  })
}
