/**
 * The IDKit request contract — Backend-Sylesh.md Phase 17.
 *
 * This is not backend-run code: IDKit runs on the client. What lives here is
 * the single source of truth for the three values the client and this backend
 * MUST agree on exactly — the action, the preset, and the signal. Every one of
 * them is re-derived server-side during verification (Phases 18-19), so a
 * frontend that improvises any of them gets every proof rejected.
 *
 * Handing the client a computed config, rather than documenting the rules and
 * hoping, is what keeps those two derivations in sync.
 */
import { env, requireWorldRpId } from '../config/env.js'
import { buildSignal } from './wallet-binding.js'

/**
 * The preset to request — NOT the generic `orbLegacy` / proof-of-human one.
 *
 * `selfieCheckLegacy` sits in IDKit's "legacy" credential group alongside
 * `orbLegacy` and `documentLegacy` (the World ID 3.0-generation credential
 * flow). It is confirmed as the only supported preset for invite-code
 * cross-device mode, and is the real, currently-working Selfie Check
 * integration path. World's docs navigation carries an unpublished page for a
 * future native integration — that is not available, so this is not a
 * placeholder.
 */
export const SELFIE_CHECK_PRESET = 'selfieCheckLegacy' as const

/**
 * Action strings are scoped per campaign, matching World's own
 * `claim-airdrop-2026`-style examples.
 *
 * The action is half of the replay-protection key: nullifiers are unique per
 * (person, app, action), so a per-campaign action is what lets one person claim
 * on two different campaigns while still being blocked from claiming twice on
 * one.
 */
export function buildWorldAction(campaignId: string): string {
  return `${env.WORLD_ACTION_PREFIX}-${campaignId}`
}

export interface IdKitRequestConfig {
  rp_id: string
  action: string
  preset: typeof SELFIE_CHECK_PRESET
  signal: string
}

/** Everything the client needs to build a valid IDKit request for one claim. */
export function buildIdKitRequestConfig(params: {
  wallet: string
  claimId: string
  campaignId: string
}): IdKitRequestConfig {
  return {
    rp_id: requireWorldRpId(),
    action: buildWorldAction(params.campaignId),
    preset: SELFIE_CHECK_PRESET,
    signal: buildSignal(params.wallet, params.claimId),
  }
}
