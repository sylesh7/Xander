/**
 * Actor resolution — Xander V2 spec section 5.1, and the "resolve actor" step
 * of the section 8 intent flow.
 *
 * One job: given something external (today, a wallet address), return the one
 * Actor it belongs to, creating it if this is the first time we have seen it.
 */
import { Prisma, type Actor } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { logger } from '../lib/logger.js'
import {
  IDENTITY_SOURCE_WALLET_ADDRESS,
  normalizeAddress,
  type ActorType,
  type IdentityKind,
} from './actor-types.js'

const UNIQUE_VIOLATION = 'P2002'

/**
 * Finds or creates the Actor owning a wallet address.
 *
 * IDEMPOTENT AND RACE-SAFE, which is a requirement rather than a nicety: two
 * intents submitted concurrently for the same wallet must resolve to one Actor,
 * not two. Two Actors holding the same wallet would make "who is acting?"
 * unanswerable and would split that wallet's trust history in half.
 *
 * The pattern is read, then create-and-catch, then re-read — the same one V1
 * arrived at for Claim after a concurrency test caught a check-then-insert race
 * there. A transaction alone would not fix it: under READ COMMITTED the losing
 * writer still sees no row and still tries to insert. Only the unique
 * constraint on (kind, externalId) makes the outcome deterministic, and the
 * catch turns the loser's error into the winner's row.
 *
 * Actor and identity are created in one nested write, so a crash between them
 * cannot leave an Actor with no way to reach it.
 */
export async function resolveActorForWallet(address: string): Promise<Actor> {
  const externalId = normalizeAddress(address)
  const kind: IdentityKind = 'WALLET'

  const existing = await prisma.actorIdentity.findUnique({
    where: { kind_externalId: { kind, externalId } },
    include: { actor: true },
  })
  if (existing) return existing.actor

  try {
    const created = await prisma.actorIdentity.create({
      data: {
        kind,
        externalId,
        // Observing an address is not proof of control (invariant 3.3).
        status: 'UNVERIFIED',
        source: IDENTITY_SOURCE_WALLET_ADDRESS,
        actor: { create: { actorType: 'WALLET' satisfies ActorType, status: 'ACTIVE' } },
      },
      include: { actor: true },
    })
    logger.debug({ actorId: created.actorId, externalId }, 'created actor for wallet')
    return created.actor
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      // Lost the race. The winner's row is authoritative.
      const winner = await prisma.actorIdentity.findUnique({
        where: { kind_externalId: { kind, externalId } },
        include: { actor: true },
      })
      if (winner) return winner.actor
    }
    throw err
  }
}

/** The Actor behind an identity, or null. Never creates. */
export async function findActorByIdentity(
  kind: IdentityKind,
  externalId: string,
): Promise<Actor | null> {
  const row = await prisma.actorIdentity.findUnique({
    where: { kind_externalId: { kind, externalId: normalizeAddress(externalId) } },
    include: { actor: true },
  })
  return row?.actor ?? null
}
