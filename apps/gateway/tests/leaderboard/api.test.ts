/**
 * Leaderboard API Tests
 *
 * These tests use a mock database implementation for unit testing.
 * For integration tests with real EQLite, run with docker-compose up.
 */

import { describe, expect, mock, test } from 'bun:test'
import { leaderboardApp } from '../../src/leaderboard/server'

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

interface A2AProfileResponse {
  result: {
    parts: Array<{
      kind: string
      data?: { profile?: { username: string } }
    }>
  }
}

interface A2AErrorResponse {
  result: { parts: Array<{ kind: string; data?: { error?: string } }> }
}

interface JsonRpcErrorResponse {
  error: { code: number }
}

// Mock the database for unit tests
const mockDb = {
  query: mock(
    async <T>(
      _sql: string,
      _params?: (string | number | boolean | null)[],
    ): Promise<T[]> => {
      return [] as T[]
    },
  ),
  exec: mock(
    async (
      _sql: string,
      _params?: (string | number | boolean | null)[],
    ): Promise<{ rowsAffected: number }> => {
      return { rowsAffected: 0 }
    },
  ),
  isHealthy: mock(async () => true),
  close: mock(async () => {
    /* mock cleanup */
  }),
}

// Mock database module
mock.module('../../src/leaderboard/db', () => ({
  getLeaderboardDB: () => mockDb,
  initLeaderboardDB: async () => {
    /* mock init */
  },
  closeLeaderboardDB: async () => {
    /* mock close */
  },
  query: mockDb.query,
  exec: mockDb.exec,
}))

describe('Leaderboard API', () => {
  test('GET /health should return ok', async () => {
    const response = await leaderboardApp.request('/health')
    const data = (await response.json()) as StatusResponse

    expect(response.status).toBe(200)
    expect(data.status).toBe('ok')
  })

  test('GET /api/leaderboard should return contributors array', async () => {
    // Mock query to return empty array
    mockDb.query.mockImplementationOnce(async () => [])

    const response = await leaderboardApp.request('/api/leaderboard')
    const data = (await response.json()) as LeaderboardResponse

    expect(response.status).toBe(200)
    expect(data.contributors).toBeDefined()
    expect(Array.isArray(data.contributors)).toBe(true)
  })

  test('GET /api/attestation without params should return 400', async () => {
    const response = await leaderboardApp.request('/api/attestation')

    expect(response.status).toBe(400)
  })

  test('POST /api/attestation without auth should return 401', async () => {
    const response = await leaderboardApp.request('/api/attestation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test', walletAddress: '0x123' }),
    })

    expect(response.status).toBe(401)
  })

  test('GET /api/wallet/verify without auth should return 401', async () => {
    const response = await leaderboardApp.request(
      '/api/wallet/verify?username=test',
    )

    expect(response.status).toBe(401)
  })

  test('POST /api/wallet/verify without auth should return 401', async () => {
    const response = await leaderboardApp.request('/api/wallet/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test',
        walletAddress: '0x1234567890123456789012345678901234567890',
        signature: '0x',
        message: 'test',
        timestamp: Date.now(),
      }),
    })

    expect(response.status).toBe(401)
  })

  test('POST /api/a2a should handle get-leaderboard skill', async () => {
    // Mock query to return contributors
    mockDb.query.mockImplementationOnce(async () => [
      {
        username: 'test1',
        avatar_url: 'https://github.com/test1.png',
        total_score: 100,
      },
    ])

    const response = await leaderboardApp.request('/api/a2a', {
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
              { kind: 'data', data: { skillId: 'get-leaderboard', limit: 5 } },
            ],
          },
        },
      }),
    })

    const data = (await response.json()) as A2AResultResponse

    expect(response.status).toBe(200)
    expect(data.result).toBeDefined()
    expect(data.result.parts.length).toBe(2)
  })

  test('POST /api/a2a should handle get-contributor-profile skill', async () => {
    // Mock query to return user and reputation
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users')) {
        return [
          {
            username: 'testuser',
            avatar_url: 'https://github.com/testuser.png',
          },
        ]
      }
      if (sql.includes('user_daily_scores')) {
        return [
          {
            total_score: 500,
            pr_score: 200,
            issue_score: 100,
            review_score: 100,
            comment_score: 100,
          },
        ]
      }
      if (sql.includes('raw_pull_requests')) {
        return [{ total_prs: 10, merged_prs: 8 }]
      }
      if (sql.includes('raw_commits')) {
        return [{ total_commits: 50 }]
      }
      return []
    })

    const response = await leaderboardApp.request('/api/a2a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        id: 2,
        params: {
          message: {
            messageId: 'test-456',
            parts: [
              {
                kind: 'data',
                data: {
                  skillId: 'get-contributor-profile',
                  username: 'testuser',
                },
              },
            ],
          },
        },
      }),
    })

    const data = (await response.json()) as A2AProfileResponse

    expect(response.status).toBe(200)
    expect(data.result).toBeDefined()
    expect(data.result.parts[1].data?.profile?.username).toBe('testuser')
  })

  test('POST /api/a2a should handle unknown skill', async () => {
    const response = await leaderboardApp.request('/api/a2a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        id: 3,
        params: {
          message: {
            messageId: 'test-789',
            parts: [{ kind: 'data', data: { skillId: 'unknown-skill' } }],
          },
        },
      }),
    })

    const data = (await response.json()) as A2AErrorResponse

    expect(response.status).toBe(200)
    expect(data.result.parts[1].data?.error).toBeDefined()
  })

  test('POST /api/a2a should reject non-message/send methods', async () => {
    const response = await leaderboardApp.request('/api/a2a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'other/method',
        id: 4,
        params: {},
      }),
    })

    const data = (await response.json()) as JsonRpcErrorResponse

    expect(response.status).toBe(200)
    // Accept either -32601 (Method not found) or -32600 (Invalid request)
    expect([-32601, -32600]).toContain(data.error.code)
  })
})

describe('Rate Limiting', () => {
  test('should track rate limits', async () => {
    // Make multiple requests
    for (let i = 0; i < 5; i++) {
      await leaderboardApp.request('/api/leaderboard')
    }

    // Should still succeed (under limit)
    const response = await leaderboardApp.request('/api/leaderboard')
    expect(response.status).toBe(200)
  })
})
