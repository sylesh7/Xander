/**
 * Active-liveness challenge service — Xander V2 spec section 10.
 *
 * Issues a fresh challenge, then verifies a submitted landmark trace against
 * it. Five things must hold before a proof counts (section 10.1):
 *
 *   nonce matches · not expired · not already consumed · session binding
 *   matches · the trace actually performed the gesture
 *
 * The first four are bookkeeping. The fifth is `liveness-geometry.ts`, and it
 * is what separates this from trusting a client-supplied boolean.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import {
  DEFAULT_GESTURE_OPTIONS,
  verifyFingerCountGesture,
  type HandFrame,
} from './liveness-geometry.js'

export class LivenessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'LivenessError'
  }
}

export const CHALLENGE_TYPES = ['SHOW_N_FINGERS'] as const
export type ChallengeType = (typeof CHALLENGE_TYPES)[number]

export interface IssuedChallenge {
  challengeId: string
  challengeType: ChallengeType
  /** How many fingers to show. */
  target: number
  nonce: string
  sessionBinding: string
  expiresAt: string
  /** Human-facing instruction the frontend renders. */
  instruction: string
}

/**
 * Issues a challenge.
 *
 * The target is drawn from a CSPRNG, not `Math.random`. A predictable challenge
 * can be pre-recorded before it is even issued, which would defeat the entire
 * point of asking.
 */
export async function issueLivenessChallenge(args: {
  actorId: string
  agentId?: string | null
  sessionBinding: string
}): Promise<IssuedChallenge> {
  if (!args.sessionBinding || args.sessionBinding.length < 8) {
    throw new LivenessError('A session binding of at least 8 characters is required.', 400)
  }

  const min = env.LIVENESS_MIN_FINGERS
  const max = env.LIVENESS_MAX_FINGERS
  const target = min + randomBytes(1)[0]! % (max - min + 1)

  const nonce = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + env.LIVENESS_CHALLENGE_TTL_SECONDS * 1000)

  const challenge = await prisma.livenessChallenge.create({
    data: {
      actorId: args.actorId,
      agentId: args.agentId ?? null,
      challengeType: 'SHOW_N_FINGERS',
      target,
      nonce,
      sessionBinding: args.sessionBinding,
      expiresAt,
      status: 'ISSUED',
    },
  })

  logger.info({ challengeId: challenge.id, actorId: args.actorId, target }, 'liveness challenge issued')

  return {
    challengeId: challenge.id,
    challengeType: 'SHOW_N_FINGERS',
    target,
    nonce,
    sessionBinding: args.sessionBinding,
    expiresAt: expiresAt.toISOString(),
    instruction: `Hold up exactly ${target} finger${target === 1 ? '' : 's'} to the camera.`,
  }
}

export interface LivenessResult {
  challengeId: string
  passed: boolean
  reason: string
  failureCode: string | null
}

/** Constant-time compare, so a mismatched nonce cannot be found byte by byte. */
function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Verifies a submitted trace.
 *
 * CONSUMED ON EVERY OUTCOME, pass or fail. Marking only successes used would
 * let an attacker retry one challenge until a synthesised trace happened to
 * satisfy it, turning a single nonce into unlimited attempts.
 */
export async function completeLivenessChallenge(args: {
  challengeId: string
  nonce: string
  sessionBinding: string
  frames: readonly HandFrame[]
  cvVersion?: string
  now?: Date
}): Promise<LivenessResult> {
  const now = args.now ?? new Date()

  const challenge = await prisma.livenessChallenge.findUnique({
    where: { id: args.challengeId },
  })
  if (!challenge) throw new LivenessError('No such challenge.', 404)

  const reject = async (code: string, reason: string): Promise<LivenessResult> => {
    await prisma.livenessChallenge.update({
      where: { id: challenge.id },
      data: {
        status: 'FAILED',
        failureReason: code,
        consumedAt: challenge.consumedAt ?? now,
        resolvedAt: now,
      },
    })
    logger.warn({ challengeId: challenge.id, code }, 'liveness challenge failed')
    return { challengeId: challenge.id, passed: false, reason, failureCode: code }
  }

  if (challenge.consumedAt) {
    return {
      challengeId: challenge.id,
      passed: false,
      reason: 'This challenge has already been used.',
      failureCode: 'ALREADY_CONSUMED',
    }
  }
  if (challenge.expiresAt.getTime() <= now.getTime()) {
    return reject('EXPIRED', 'The challenge expired before a proof arrived.')
  }
  if (!secretsMatch(args.nonce, challenge.nonce)) {
    return reject('NONCE_MISMATCH', 'The nonce did not match the issued challenge.')
  }
  if (!secretsMatch(args.sessionBinding, challenge.sessionBinding)) {
    return reject('SESSION_BINDING_MISMATCH', 'The proof came from a different session.')
  }

  // The actual verification. Everything above only established that this proof
  // belongs to this challenge; this decides whether it performed it.
  const verdict = verifyFingerCountGesture(args.frames, challenge.target, DEFAULT_GESTURE_OPTIONS)

  if (!verdict.passed) {
    await prisma.livenessChallenge.update({
      where: { id: challenge.id },
      data: {
        status: 'FAILED',
        failureReason: verdict.failure,
        consumedAt: now,
        resolvedAt: now,
        // Derived counts only — never imagery, never landmarks. Enough to
        // explain the verdict, not enough to reconstruct anything (section 28).
        signalJson: { observedCounts: verdict.observedCounts } as Prisma.InputJsonValue,
        cvVersion: args.cvVersion ?? null,
      },
    })
    logger.warn(
      { challengeId: challenge.id, failure: verdict.failure },
      'liveness gesture rejected',
    )
    return {
      challengeId: challenge.id,
      passed: false,
      reason: verdict.detail,
      failureCode: verdict.failure,
    }
  }

  await prisma.livenessChallenge.update({
    where: { id: challenge.id },
    data: {
      status: 'PASSED',
      consumedAt: now,
      resolvedAt: now,
      signalJson: { observedCounts: verdict.observedCounts } as Prisma.InputJsonValue,
      cvVersion: args.cvVersion ?? null,
    },
  })
  logger.info({ challengeId: challenge.id }, 'liveness challenge passed')

  return { challengeId: challenge.id, passed: true, reason: verdict.detail, failureCode: null }
}

/** Marks overdue challenges EXPIRED. Housekeeping for the operator view. */
export async function expireStaleChallenges(now = new Date()): Promise<number> {
  const { count } = await prisma.livenessChallenge.updateMany({
    where: { status: 'ISSUED', expiresAt: { lte: now } },
    data: { status: 'EXPIRED', resolvedAt: now },
  })
  return count
}
