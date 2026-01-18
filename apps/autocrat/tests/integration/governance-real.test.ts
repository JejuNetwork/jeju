/**
 * Governance API Integration Tests
 *
 * Requires: bun run dev (starts API at localhost:3001)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getLocalhostHost,
} from '@jejunetwork/config'
import { z } from 'zod'

const host = getLocalhostHost()
const API_URL =
  process.env.AUTOCRAT_URL ??
  getCoreAppUrl('AUTOCRAT_API') ??
  `http://${host}:${CORE_PORTS.AUTOCRAT_API.get()}`

const DAOSchema = z.object({
  daoId: z.string().min(1),
  displayName: z.string(),
  description: z.string(),
})

const QuickScoreSchema = z.object({
  score: z.number().min(0).max(100),
  contentHash: z.string().min(1),
  readyForFullAssessment: z.boolean(),
})

const ctx = {
  existingDaoId: null as string | null,
  testsRun: 0,
}

async function api<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{
  data: T
  status: number
  ms: number
}> {
  const start = performance.now()
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  })
  return {
    data: (await res.json().catch(() => ({}))) as T,
    status: res.status,
    ms: performance.now() - start,
  }
}

// Autocrat API is required infrastructure - tests must fail if it's not running
beforeAll(async () => {
  const res = await fetch(`${API_URL}/health`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)

  if (!res?.ok) {
    throw new Error(
      `Autocrat API is required but not running at ${API_URL}. Start with: cd apps/autocrat && bun run dev`,
    )
  }

  const { data, status } = await api<{ daos: Array<{ daoId: string }> }>(
    'GET',
    '/api/v1/dao/list',
  )
  if (status === 200 && data.daos?.length) {
    ctx.existingDaoId = data.daos[0].daoId
  }

  console.log(
    `API: ✅ ${ctx.existingDaoId ? `(DAO: ${ctx.existingDaoId})` : ''}`,
  )
})

afterAll(() => console.log(`Run: ${ctx.testsRun}`))

// DAO Endpoints

describe('GET /api/v1/dao/list', () => {
  test('returns validated DAO array', async () => {
    ctx.testsRun++
    const { data, status } = await api<{ daos: unknown[] }>(
      'GET',
      '/api/v1/dao/list',
    )
    expect(status).toBe(200)
    expect(Array.isArray(data.daos)).toBe(true)
    for (const dao of data.daos) {
      expect(DAOSchema.safeParse(dao).success).toBe(true)
    }
  })
})

describe('GET /api/v1/dao/:id', () => {
  test('404 for non-existent', async () => {
    ctx.testsRun++
    const { status } = await api('GET', '/api/v1/dao/nonexistent-99999')
    expect(status).toBe(404)
  })

  test('special characters in ID', async () => {
    ctx.testsRun++
    for (const id of ['test%20space', 'test<script>', '../etc/passwd']) {
      const { status } = await api(
        'GET',
        `/api/v1/dao/${encodeURIComponent(id)}`,
      )
      expect(status).not.toBe(500)
    }
  })
})

// Proposal Scoring

describe('POST /api/v1/proposals/quick-score', () => {
  const validProposal = {
    daoId: 'test',
    title: 'Test',
    summary: 'Test',
    description: 'Test',
    proposalType: 0,
  }

  test('returns valid score', async () => {
    ctx.testsRun++
    const { data, status } = await api<z.infer<typeof QuickScoreSchema>>(
      'POST',
      '/api/v1/proposals/quick-score',
      validProposal,
    )
    expect(status).toBe(200)
    expect(QuickScoreSchema.safeParse(data).success).toBe(true)
  })

  test('minimal proposal', async () => {
    ctx.testsRun++
    const { data, status } = await api<{ score: number }>(
      'POST',
      '/api/v1/proposals/quick-score',
      {
        daoId: 'x',
        title: 'A',
        summary: 'B',
        description: 'C',
        proposalType: 0,
      },
    )
    expect(status).toBe(200)
    expect(data.score).toBeGreaterThanOrEqual(0)
    expect(data.score).toBeLessThanOrEqual(100)
  })

  test('unicode content', async () => {
    ctx.testsRun++
    const { status } = await api('POST', '/api/v1/proposals/quick-score', {
      daoId: 'test-日本語',
      title: '提案 🎉',
      summary: 'Résumé 👍',
      description: '中文',
      proposalType: 0,
    })
    expect(status).toBe(200)
  })

  test('handles empty strings with zero score', async () => {
    ctx.testsRun++
    const { data, status } = await api<{ score: number }>(
      'POST',
      '/api/v1/proposals/quick-score',
      {
        daoId: '',
        title: '',
        summary: '',
        description: '',
        proposalType: 0,
      },
    )
    // API accepts empty proposals but gives them a score of 0
    expect(status).toBe(200)
    expect(data.score).toBe(0)
  })

  test('rejects missing fields', async () => {
    ctx.testsRun++
    const { status } = await api('POST', '/api/v1/proposals/quick-score', {
      title: 'Only title',
    })
    expect([400, 422]).toContain(status) // 422 for validation errors
  })

  test('rejects wrong types', async () => {
    ctx.testsRun++
    const { status } = await api('POST', '/api/v1/proposals/quick-score', {
      daoId: 123,
      title: 'test',
      summary: 'test',
      description: 'test',
      proposalType: 0,
    } as Record<string, unknown>)
    expect([400, 422]).toContain(status) // 422 for validation errors
  })

  test('deterministic hash', async () => {
    ctx.testsRun++
    const [r1, r2] = await Promise.all([
      api<{ contentHash: string }>(
        'POST',
        '/api/v1/proposals/quick-score',
        validProposal,
      ),
      api<{ contentHash: string }>(
        'POST',
        '/api/v1/proposals/quick-score',
        validProposal,
      ),
    ])
    expect(r1.data.contentHash).toBe(r2.data.contentHash)
  })
})

// Concurrency

describe('Concurrent requests', () => {
  test('10 parallel list requests', async () => {
    ctx.testsRun++
    const results = await Promise.all(
      Array(10)
        .fill(null)
        .map(() => api<{ daos: unknown[] }>('GET', '/api/v1/dao/list')),
    )
    for (const r of results) {
      expect(r.status).toBe(200)
    }
  })

  test('5 parallel score requests', async () => {
    ctx.testsRun++
    const proposals = Array(5)
      .fill(null)
      .map((_, i) => ({
        daoId: `test-${i}`,
        title: `P${i}`,
        summary: `S${i}`,
        description: `D${i}`,
        proposalType: 0,
      }))
    const results = await Promise.all(
      proposals.map((p) =>
        api<{ score: number }>('POST', '/api/v1/proposals/quick-score', p),
      ),
    )
    for (const r of results) {
      expect(r.status).toBe(200)
    }
  })
})

// Error Handling

describe('Error handling', () => {
  test('malformed JSON', async () => {
    ctx.testsRun++
    const res = await fetch(`${API_URL}/api/v1/proposals/quick-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid }',
    })
    expect(res.status).toBe(400)
  })

  test('unknown route', async () => {
    ctx.testsRun++
    const { status } = await api('GET', '/api/v1/nonexistent')
    expect(status).toBe(404)
  })

  test('wrong method', async () => {
    ctx.testsRun++
    const { status } = await api('POST', '/api/v1/dao/list', {})
    expect([404, 405]).toContain(status)
  })
})

// Performance

describe('Performance', () => {
  test('list endpoints < 2s', async () => {
    ctx.testsRun++
    for (const ep of ['/api/v1/dao/list', '/api/v1/proposals']) {
      const { status, ms } = await api('GET', ep)
      expect(status).toBe(200)
      expect(ms).toBeLessThan(2000)
    }
  })
})

// Security

describe('Security', () => {
  test('handles XSS input', async () => {
    ctx.testsRun++
    const { status } = await api('POST', '/api/v1/proposals/quick-score', {
      daoId: '<script>alert(1)</script>',
      title: '<img onerror=alert(1)>',
      summary: 'test',
      description: 'test',
      proposalType: 0,
    })
    expect(status).not.toBe(500)
  })
})
