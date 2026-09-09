/**
 * Nullifier storage and replay protection — Backend-Sylesh.md Phase 19.
 *
 * A nullifier is the same for the same person + same app + same action, every
 * time. The Developer Portal confirms only that a proof is cryptographically
 * VALID — checking that it has not been used before is explicitly this
 * backend's job, and nothing upstream will do it.
 *
 * NOT THE SAME THING AS THE UNIQUENESS SIGNAL. Selfie Check also returns a
 * medium-assurance uniqueness signal via Anonymized Multi-Party Computation —
 * World's own claim about whether this *person* has been seen before,
 * independent of this app. The nullifier below stops the same *proof* being
 * replayed for the same action. Conflating them would produce logic that looks
 * right and enforces neither.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

export class ReplayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplayError'
  }
}

/**
 * World returns nullifiers as 0x-hex 256-bit integers; Postgres has no native
 * 256-bit int, so `VerificationChallenge.nullifier` is Decimal(78, 0) and the
 * value must be converted before it is stored.
 *
 * Storing the hex string instead would silently break uniqueness: `0x0a` and
 * `0xA` are the same nullifier and different strings, so the same proof could
 * be replayed by re-encoding it.
 */
export function nullifierToDecimalString(nullifier: string): string {
  let value: bigint
  try {
    value = BigInt(nullifier)
  } catch {
    throw new ReplayError(`Nullifier is not a valid integer: ${nullifier}`)
  }
  if (value < 0n) throw new ReplayError('Nullifier must be non-negative.')
  return value.toString(10)
}

/**
 * Binds a verified proof's nullifier to its challenge, rejecting reuse.
 *
 * The check-then-write is backed by the `@@unique([nullifier, worldActionId])`
 * constraint rather than trusting the read: two concurrent redemptions of the
 * same proof would both pass a bare existence check. The database decides, and
 * a unique violation here IS the replay — it is caught and reported as one,
 * never surfaced as a 500.
 */
export async function recordNullifier(params: {
  challengeId: string
  nullifier: string
  rpId: string
}): Promise<void> {
  const decimal = nullifierToDecimalString(params.nullifier)

  // The action comes from the challenge row, never from the caller. Accepting
  // it as an argument allowed the uniqueness check and the write to disagree
  // about which action was being claimed — the check would clear one scope
  // while the constraint fired on another.
  const challenge = await prisma.verificationChallenge.findUnique({
    where: { id: params.challengeId },
    select: { worldActionId: true },
  })
  if (!challenge) throw new ReplayError(`Challenge ${params.challengeId} not found.`)

  const existing = await prisma.verificationChallenge.findUnique({
    where: {
      nullifier_worldActionId: {
        nullifier: new Prisma.Decimal(decimal),
        worldActionId: challenge.worldActionId,
      },
    },
  })

  if (existing && existing.id !== params.challengeId) {
    throw new ReplayError(
      'This proof has already been used for this action. A nullifier is single-use per ' +
        'action by design.',
    )
  }

  try {
    await prisma.verificationChallenge.update({
      where: { id: params.challengeId },
      data: {
        nullifier: new Prisma.Decimal(decimal),
        rpId: params.rpId,
        status: 'PASSED',
        resolvedAt: new Date(),
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ReplayError(
        'This proof has already been used for this action (detected on write).',
      )
    }
    throw err
  }
}
