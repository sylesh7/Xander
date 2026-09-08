import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../src/server.js'

describe('GET /health', () => {
  it('returns ok: true — Phase 2 acceptance test', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('includes provenance data — Phase 11', async () => {
    const res = await request(app).get('/health')
    expect(res.body).toHaveProperty('provenance')
    if (res.body.provenance !== null) {
      expect(res.body.provenance).toHaveProperty('tokenApi')
      expect(res.body.provenance).toHaveProperty('deployments')
      expect(res.body.provenance).toHaveProperty('substreams')
    }
  })
})
