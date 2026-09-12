/**
 * The Temporal worker — Xander V2 Phase 4.
 *
 * Runs as its own process (`npm run worker`), not inside the API. A worker
 * polls, executes and can be killed and restarted at any moment; the API
 * serves requests. Coupling them would mean a deploy of one interrupts
 * in-flight workflows of the other, which is precisely the failure Temporal is
 * here to eliminate.
 */
import { fileURLToPath } from 'node:url'
import { NativeConnection, Worker } from '@temporalio/worker'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import * as activities from './activities.js'

export async function runWorker(): Promise<void> {
  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS })

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    // A path, not an import: workflow code is bundled into a separate isolate
    // so its determinism can be enforced. Importing it here would pull Node
    // built-ins into that sandbox.
    workflowsPath: fileURLToPath(new URL('./workflows.js', import.meta.url)),
    activities,
  })

  logger.info(
    {
      address: env.TEMPORAL_ADDRESS,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
    },
    'temporal worker starting',
  )

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'temporal worker shutting down')
    worker.shutdown()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Blocks until shutdown. In-flight activities are allowed to finish, and any
  // workflow mid-wait simply resumes on the next worker — that resumption is
  // the property Phase 4 exists to prove.
  await worker.run()
  await connection.close()
  logger.info('temporal worker stopped')
}

const entry = process.argv[1]
if (entry && import.meta.url === new URL(`file://${entry}`).href) {
  runWorker().catch((err: unknown) => {
    logger.error({ err }, 'temporal worker failed')
    process.exitCode = 1
  })
}
