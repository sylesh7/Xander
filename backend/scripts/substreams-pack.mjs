#!/usr/bin/env node
/**
 * Cross-shell `substreams pack`, invoked as `npm run substreams:pack`.
 *
 * The previous version of this script used bash's `$(pwd)` inline in
 * package.json to build the Docker volume mount. npm scripts run through
 * whatever shell invoked `npm run` — PowerShell on a default Windows setup —
 * and PowerShell does not expand `$(pwd)`, so the mount silently became the
 * literal four-character string "$(pwd)/substreams" and Docker rejected it as
 * an invalid volume name. Confirmed by running it in PowerShell.
 *
 * Doing the path resolution in Node instead of shell syntax means this script
 * behaves identically under bash, PowerShell, and cmd.exe — Node's own
 * `path.resolve` needs no shell substitution at all.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const backendDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const substreamsDir = resolve(backendDir, 'substreams')

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-v',
    `${substreamsDir}:/work`,
    '-w',
    '/work',
    'ghcr.io/streamingfast/substreams:v1.22.0',
    'pack',
    './substreams.yaml',
    '-o',
    './sybil_shield_substreams-v0.1.0.spkg',
  ],
  { stdio: 'inherit' },
)

process.exit(result.status ?? 1)
