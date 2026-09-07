/**
 * Schema family: dex-amm (Messari DEX AMM schema v1.3.2).
 *
 * Backend-Suganthan.md Phase 4 explicitly flagged this family's entity names as
 * NOT independently verified and told us to pull them from the live docs rather
 * than guess. Done — these were read off the live Messari `schema-dex-amm.graphql`
 * on 2026-09-07. Every top-level entity in that schema:
 *
 *   Token, RewardToken, LiquidityPoolFee, DexAmmProtocol,
 *   UsageMetricsDailySnapshot, UsageMetricsHourlySnapshot,
 *   FinancialsDailySnapshot, LiquidityPool, LiquidityPoolDailySnapshot,
 *   LiquidityPoolHourlySnapshot, Deposit, Withdraw, Swap, Account, ActiveAccount
 *
 * Note the shape differs from lending-cdp in ways that matter: the pool entity
 * is `liquidityPools` (not `markets`), there is a `swaps` entity with no
 * lending equivalent, and events relate to a pool via `pool`, not `market`.
 * This is exactly why the code is organised per family rather than per protocol.
 */
import { queryFamily } from '../client.js'
import { getDeploymentsForFamily } from '../deployment-registry.js'
import type { DeploymentEntry, ProvenancedResult } from '../types.js'

export const SCHEMA_FAMILY = 'dex-amm' as const

export interface DexEvent {
  id: string
  hash: string
  logIndex: number
  blockNumber: string
  timestamp: string
  account: { id: string }
  pool: { id: string; name?: string | null }
}

export interface DexSwap extends DexEvent {
  amountIn: string
  amountOut: string
  amountInUSD?: string | null
  amountOutUSD?: string | null
  tokenIn: { id: string; symbol?: string | null }
  tokenOut: { id: string; symbol?: string | null }
}

export interface DexAccountActivity {
  account: {
    id: string
    depositCount?: number
    withdrawCount?: number
    swapCount?: number
  } | null
  swaps: DexSwap[]
  deposits: DexEvent[]
  withdraws: DexEvent[]
}

const BASE_EVENT_FIELDS = `
  id
  hash
  logIndex
  blockNumber
  timestamp
  account { id }
  pool { id name }
`

/**
 * A wallet's DEX footprint on one deployment.
 *
 * `swaps` is the signal that does not exist in lending data: coordinated
 * wallets routing identical trades through the same pools in the same order is
 * a strong PROTOCOL_BEHAVIOR_SIMILARITY input, and shared pools feed
 * SHARED_COUNTERPARTY.
 */
export const ACCOUNT_ACTIVITY_QUERY = `
query DexAccountActivity($account: String!, $first: Int!) {
  account(id: $account) {
    id
    depositCount
    withdrawCount
    swapCount
  }
  swaps(where: { account: $account }, first: $first, orderBy: timestamp, orderDirection: asc) {
    ${BASE_EVENT_FIELDS}
    amountIn
    amountOut
    amountInUSD
    amountOutUSD
    tokenIn { id symbol }
    tokenOut { id symbol }
  }
  deposits(where: { account: $account }, first: $first, orderBy: timestamp, orderDirection: asc) {${BASE_EVENT_FIELDS}}
  withdraws(where: { account: $account }, first: $first, orderBy: timestamp, orderDirection: asc) {${BASE_EVENT_FIELDS}}
}`

export async function getAccountActivityAcrossFamily(
  account: string,
  opts: { first?: number; deployments?: DeploymentEntry[] } = {},
): Promise<
  Array<
    { entry: DeploymentEntry } & (
      { result: ProvenancedResult<DexAccountActivity> } | { error: Error }
    )
  >
> {
  const deployments = opts.deployments ?? (await getDeploymentsForFamily(SCHEMA_FAMILY))
  return queryFamily<DexAccountActivity>(deployments, ACCOUNT_ACTIVITY_QUERY, {
    account: account.toLowerCase(),
    first: opts.first ?? 100,
  })
}
