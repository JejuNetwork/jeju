/**
 * Governance API Integration Tests
 *
 * Requires: bun run dev (starts API at localhost:3001)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { z } from 'zod'

const API_URL = process.env.AUTOCRAT_URL ?? 'http://localhost:3001'

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
  apiAvailable: false,
  existingDaoId: null as string | null,
  testsRun: 0,
  testsSkipped: 0,
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

function skip(_name: string): boolean {
  if (!ctx.apiAvailable) {
    ctx.testsSkipped++
    return true
  }
  ctx.testsRun++
  return false
}

beforeAll(async () => {
  try {
    const res = await fetch(`${API_URL}/api/health`, {
      signal: AbortSignal.timeout(5000),
    })
    ctx.apiAvailable = res.ok
  } catch {
    ctx.apiAvailable = false
  }

  if (ctx.apiAvailable) {
    const { data, status } = await api<{ daos: Array<{ daoId: string }> }>(
      'GET',
      '/api/v1/dao/list',
    )
    if (status === 200 && data.daos?.length) {
      ctx.existingDaoId = data.daos[0].daoId
    }
  }

  console.log(
    `API: ${ctx.apiAvailable ? '✅' : '❌'} ${ctx.existingDaoId ? `(DAO: ${ctx.existingDaoId})` : ''}`,
  )
})

afterAll(() =>
  console.log(`Run: ${ctx.testsRun} | Skipped: ${ctx.testsSkipped}`),
)

// DAO Endpoints

describe('GET /api/v1/dao/list', () => {
  test('returns validated DAO array', async () => {
    if (skip('dao-list')) return
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
    if (skip('dao-404')) return
    const { status } = await api('GET', '/api/v1/dao/nonexistent-99999')
    expect(status).toBe(404)
  })

  test('special characters in ID', async () => {
    if (skip('dao-special')) return
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
    if (skip('score')) return
    const { data, status } = await api<z.infer<typeof QuickScoreSchema>>(
      'POST',
      '/api/v1/proposals/quick-score',
      validProposal,
    )
    expect(status).toBe(200)
    expect(QuickScoreSchema.safeParse(data).success).toBe(true)
  })

  test('minimal proposal', async () => {
    if (skip('score-min')) return
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
    if (skip('score-unicode')) return
    const { status } = await api('POST', '/api/v1/proposals/quick-score', {
      daoId: 'test-日本語',
      title: '提案 🎉',
      summary: 'Résumé 👍',
      description: '中文',
      proposalType: 0,
    })
    expect(status).toBe(200)
  })

  test('rejects empty strings', async () => {
    if (skip('score-empty')) return
    const { status } = await api('POST', '/api/v1/proposals/quick-score', {
      daoId: '',
      title: '',
      summary: '',
      description: '',
      proposalType: 0,
    })
    expect(status).toBe(400)
  })

  test('rejects missing fields', async () => {
    if (skip('score-missing')) return
    const { status } = await api('POST', '/api/v1/proposals/quick-score', {
      title: 'Only title',
    })
    expect(status).toBe(400)
  })

  test('rejects wrong types', async () => {
    if (skip('score-types')) return
    const { status } = await api('POST', '/api/v1/proposals/quick-score', {
      daoId: 123,
      title: 'test',
      summary: 'test',
      description: 'test',
      proposalType: 0,
    } as Record<string, unknown>)
    expect(status).toBe(400)
  })

  test('deterministic hash', async () => {
    if (skip('score-hash')) return
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
    if (skip('concurrent-list')) return
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
    if (skip('concurrent-score')) return
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
    if (skip('err-json')) return
    const res = await fetch(`${API_URL}/api/v1/proposals/quick-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid }',
    })
    expect(res.status).toBe(400)
  })

  test('unknown route', async () => {
    if (skip('err-404')) return
    const { status } = await api('GET', '/api/v1/nonexistent')
    expect(status).toBe(404)
  })

  test('wrong method', async () => {
    if (skip('err-method')) return
    const { status } = await api('POST', '/api/v1/dao/list', {})
    expect([404, 405]).toContain(status)
  })
})

// Performance

describe('Performance', () => {
  test('list endpoints < 2s', async () => {
    if (skip('perf')) return
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
    if (skip('sec-xss')) return
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
