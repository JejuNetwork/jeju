/**
 * Leaderboard API Integration Tests
 *
 * REQUIRES: Jeju CLI infrastructure (SQLit, localnet)
 * Run with: jeju test --mode integration --app gateway
 *
 * These tests run against the real leaderboard server with SQLit.
 * They will automatically skip if infrastructure is not available.
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import type { Elysia } from 'elysia'

// Test response types
interface StatusResponse {
  status: string
}

interface LeaderboardResponse {
  contributors: Array<{
    username: string
    avatar_url: string
    total_score: number
  }>
}

interface A2AResultResponse {
  result: { parts: Array<{ kind: string }> }
}

interface JsonRpcErrorResponse {
  error: { code: number }
}

let leaderboardApp: Elysia
let isInfraAvailable = false

beforeAll(async () => {
  // Check if infrastructure is available
  try {
    const module = await import('../../../api/leaderboard/server')
    leaderboardApp = module.leaderboardApp
    isInfraAvailable = true
  } catch (_error) {
    console.warn(
      '⚠️  Leaderboard tests skipped: Jeju CLI infrastructure required',
    )
    console.warn('   Run with: jeju test --mode integration --app gateway')
    isInfraAvailable = false
  }
})

describe('Leaderboard API', () => {
  test('GET /health should return ok', async () => {
    if (!isInfraAvailable) {
      console.log('SKIP: Infrastructure not available')
      return
    }

    const response = await leaderboardApp.handle(
      new Request('http://localhost/health'),
    )
    const data = (await response.json()) as StatusResponse

    expect(response.status).toBe(200)
    expect(data.status).toBe('ok')
  })

  test('GET /api/leaderboard should return contributors array', async () => {
    if (!isInfraAvailable) {
      console.log('SKIP: Infrastructure not available')
      return
    }

    const response = await leaderboardApp.handle(
      new Request('http://localhost/api/leaderboard'),
    )
    const data = (await response.json()) as LeaderboardResponse

    expect(response.status).toBe(200)
    expect(data.contributors).toBeDefined()
    expect(Array.isArray(data.contributors)).toBe(true)
  })

  test('GET /api/attestation without params should return 400', async () => {
    if (!isInfraAvailable) {
      console.log('SKIP: Infrastructure not available')
      return
    }

    const response = await leaderboardApp.handle(
      new Request('http://localhost/api/attestation'),
    )

    expect(response.status).toBe(400)
  })

  test('POST /api/attestation without auth should return 401', async () => {
    if (!isInfraAvailable) {
      console.log('SKIP: Infrastructure not available')
      return
    }

    const response = await leaderboardApp.handle(
      new Request('http://localhost/api/attestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'test', walletAddress: '0x123' }),
      }),
    )

    expect(response.status).toBe(401)
  })

  test('POST /api/a2a should handle get-leaderboard skill', async () => {
    if (!isInfraAvailable) {
      console.log('SKIP: Infrastructure not available')
      return
    }

    const response = await leaderboardApp.handle(
      new Request('http://localhost/api/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'message/send',
          id: 1,
          params: {
            message: {
              messageId: 'test-123',
              parts: [
                {
                  kind: 'data',
                  data: { skillId: 'get-leaderboard', limit: 5 },
                },
              ],
            },
          },
        }),
      }),
    )

    const data = (await response.json()) as A2AResultResponse

    expect(response.status).toBe(200)
    expect(data.result).toBeDefined()
    expect(data.result.parts.length).toBeGreaterThanOrEqual(1)
  })

  test('POST /api/a2a should reject non-message/send methods', async () => {
    if (!isInfraAvailable) {
      console.log('SKIP: Infrastructure not available')
      return
    }

    const response = await leaderboardApp.handle(
      new Request('http://localhost/api/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'other/method',
          id: 4,
          params: {},
        }),
      }),
    )

    const data = (await response.json()) as JsonRpcErrorResponse

    expect(response.status).toBe(200)
    // Accept either -32601 (Method not found) or -32600 (Invalid request)
    expect([-32601, -32600]).toContain(data.error.code)
  })
})

describe('Rate Limiting', () => {
  test('should handle multiple requests without rate limiting', async () => {
    if (!isInfraAvailable) {
      console.log('SKIP: Infrastructure not available')
      return
    }

    // Make multiple requests (under the rate limit)
    for (let i = 0; i < 5; i++) {
      await leaderboardApp.handle(
        new Request('http://localhost/api/leaderboard'),
      )
    }

    // Should still succeed
    const response = await leaderboardApp.handle(
      new Request('http://localhost/api/leaderboard'),
    )
    expect(response.status).toBe(200)
  })
})
