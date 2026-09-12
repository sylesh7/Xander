/**
 * Actor service — Xander V2 spec sections 5.1, 5.2 and the `/v2/actors` surface
 * in section 24.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import {
  IDENTITY_SOURCE_WALLET_ADDRESS,
  normalizeAddress,
  type ActorType,
  type IdentityKind,
} from './actor-types.js'

const UNIQUE_VIOLATION = 'P2002'

export class ActorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ActorError'
  }
}

export interface CreateActorInput {
  actorType: ActorType
  displayName?: string | undefined
  /** Optional wallet to bind at creation time. */
  wallet?: { address: string } | undefined
}

export interface ActorView {
  id: string
  actorType: string
  status: string
  displayName: string | null
  identities: Array<{
    kind: string
    externalId: string
    status: string
    source: string
    verifiedAt: string | null
  }>
  createdAt: string
  updatedAt: string
}

/**
 * Creates an actor, optionally binding a wallet in the same write.
 *
 * A wallet already bound to another Actor is a 409, not a silent re-parent.
 * Moving a wallet between actors would rewrite whose history it is, and that is
 * a decision no automated path should make on its own.
 */
export async function createActor(input: CreateActorInput): Promise<ActorView> {
  const walletId = input.wallet ? normalizeAddress(input.wallet.address) : null

  if (walletId) {
    const clash = await prisma.actorIdentity.findUnique({
      where: { kind_externalId: { kind: 'WALLET', externalId: walletId } },
    })
    if (clash) {
      throw new ActorError(
        `Wallet ${walletId} is already bound to actor ${clash.actorId}.`,
        409,
      )
    }
  }

  try {
    const actor = await prisma.actor.create({
      data: {
        actorType: input.actorType,
        status: 'ACTIVE',
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(walletId
          ? {
              identities: {
                create: {
                  kind: 'WALLET' satisfies IdentityKind,
                  externalId: walletId,
                  status: 'UNVERIFIED',
                  source: IDENTITY_SOURCE_WALLET_ADDRESS,
                },
              },
            }
          : {}),
      },
      include: { identities: true },
    })
    return toActorView(actor)
  } catch (err) {
    // Lost a race against a concurrent bind of the same wallet.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      throw new ActorError(`Wallet ${walletId ?? ''} is already bound to another actor.`, 409)
    }
    throw err
  }
}

/** One actor with its identities, or null. */
export async function getActor(id: string): Promise<ActorView | null> {
  const actor = await prisma.actor.findUnique({ where: { id }, include: { identities: true } })
  return actor ? toActorView(actor) : null
}

type ActorRow = Prisma.ActorGetPayload<{ include: { identities: true } }>

function toActorView(actor: ActorRow): ActorView {
  return {
    id: actor.id,
    actorType: actor.actorType,
    status: actor.status,
    displayName: actor.displayName,
    identities: actor.identities.map((i) => ({
      kind: i.kind,
      externalId: i.externalId,
      status: i.status,
      source: i.source,
      verifiedAt: i.verifiedAt?.toISOString() ?? null,
    })),
    createdAt: actor.createdAt.toISOString(),
    updatedAt: actor.updatedAt.toISOString(),
  }
}
