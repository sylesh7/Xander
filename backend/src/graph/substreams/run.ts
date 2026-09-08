/**
 * CLI entrypoint for the Phase 10 stream consumer.
 *
 * Usage:
 *   node --env-file=.env --import tsx src/graph/substreams/run.ts \
 *     --spkg substreams/sybil_shield_substreams-v0.1.0.spkg \
 *     --network mainnet \
 *     --watch 0xabc...,0xdef... \
 *     --start 21000000 \
 *     --stop +1000
 *
 * `--watch` omitted or empty streams every transfer on the chain — correct for
 * a short verification range, ruinous at head (documented in substreams.yaml).
 */
import { runSubstreamsStream } from './stream.js'
import { closeInvalidationQueue } from './invalidation-queue.js'
import { logger } from '../../lib/logger.js'
import { prisma } from '../../lib/prisma.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const spkgPath = arg('spkg')
if (!spkgPath) {
  console.error(
    'Usage: run.ts --spkg <path or URL> [--network mainnet] [--watch a,b,c] [--start N] [--stop +N]',
  )
  process.exit(1)
}

const stopArg = arg('stop')
const stopBlock =
  stopArg === undefined
    ? undefined
    : stopArg.startsWith('+')
      ? (stopArg as `+${number}`)
      : Number(stopArg)

const network = arg('network')
const watchList = arg('watch')
const startArg = arg('start')

/**
 * BullMQ's Queue holds an ioredis connection open, and Prisma holds its pool
 * open — neither closes itself, so a bounded (--stop) run never exits without
 * this. Confirmed by running it: the process hung indefinitely after the
 * stream completed and all data was correctly persisted.
 */
async function shutdown(): Promise<void> {
  await Promise.allSettled([closeInvalidationQueue(), prisma.$disconnect()])
}

runSubstreamsStream({
  spkgPath,
  ...(network !== undefined ? { network } : {}),
  ...(watchList !== undefined ? { watchList } : {}),
  ...(startArg !== undefined ? { startBlock: BigInt(startArg) } : {}),
  ...(stopBlock !== undefined ? { stopBlock } : {}),
})
  .catch((err: unknown) => {
    logger.error({ err }, 'substreams stream exited with an error')
    process.exitCode = 1
  })
  .finally(shutdown)
