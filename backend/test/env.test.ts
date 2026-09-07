import { describe, expect, it } from 'vitest'
import { env } from '../src/config/env.js'

describe('env config', () => {
  it('parses and exposes required core settings', () => {
    expect(env.DATABASE_URL).toBeTruthy()
    expect(env.REDIS_URL).toBeTruthy()
  })

  it('applies documented Phase 6/7 defaults', () => {
    expect(env.EDGE_THRESHOLD).toBe(0.5)
    expect(env.MIN_CLUSTER_SIZE).toBe(2)
    expect(env.FUNDING_WINDOW_HOURS).toBe(24)
    expect(env.TIMING_NORMALIZATION_SECONDS).toBe(3600)
  })

  it('keeps Substreams enabled — locked P0, not feature-flagged off', () => {
    expect(env.ENABLE_SUBSTREAMS).toBe(true)
  })
})
