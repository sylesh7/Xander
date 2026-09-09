/**
 * Sylesh-side fixture addresses — Backend-Sylesh.md Phase 23.
 *
 * Mirrors the convention Suganthan set in `src/interfaces/stub-fixtures.ts`:
 * import the constant, never paste the literal, so the seed and the tests can
 * never drift apart.
 *
 * Every address here is a valid 0x-prefixed 40-character hex string, because
 * these are the wallets the acceptance tests push through `POST /screen-claim`
 * and that route validates address shape at the boundary.
 *
 * Suganthan's two fixtures cover the ALLOW and BLOCK ends. The pair below
 * exists because neither of those exercises the CHALLENGE band, and CHALLENGE
 * is the entire escalation path: without a wallet that actually lands in it,
 * the World integration can only ever be tested with hand-written rows.
 */

/** Pads a hex suffix into a full 40-character address. */
const addr = (suffix: string): string => `0x${suffix.padStart(40, '0')}`

/**
 * A two-wallet cluster that scores in the CHALLENGE band (0.43 under seeded
 * policy 1.0, measured — not asserted from the formula).
 *
 * The shape is deliberate: a shared funder inside the 24h window is strong
 * enough to form the cluster edge and drive FUNDING_CORRELATION to 1.0, while
 * a 20-hour funding gap, ~45k blocks of age difference, one shared counterparty
 * out of four, and divergent four-step protocol paths keep every other feature
 * low. That combination is what a *plausibly* coordinated pair looks like — the
 * case where asking for one more signal is the right answer, rather than
 * allowing or blocking outright.
 */
export const FIXTURE_CHALLENGE_WALLET = addr('cae1')
export const FIXTURE_CHALLENGE_MATE = addr('cae2')
export const FIXTURE_CHALLENGE_FUNDER = addr('fdcae0')
export const FIXTURE_CHALLENGE_SHARED_COUNTERPARTY = addr('5aa4ed')

/** Campaign id the seeded Sylesh claims belong to. */
export const FIXTURE_CAMPAIGN_ID = 'xander-demo-campaign'

/** Wallets used for the seeded claim/challenge lifecycle rows. */
export const FIXTURE_CHALLENGE_STATE_WALLET = addr('c8a11e')
export const FIXTURE_PASSED_STATE_WALLET = addr('9a55ed')
export const FIXTURE_FAILED_STATE_WALLET = addr('fa11ed')
export const FIXTURE_EXPIRED_STATE_WALLET = addr('e8f14ed')
