/**
 * Concurrent Tests - Parallel execution and async handling
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { type APIRequestContext, expect, test } from '@playwright/test'

const AUTOCRAT_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_API.get()}`

interface DeliberationVote {
  role: string
  vote: string
  reasoning: string
}

interface A2APartData {
  skillId?: string
  params?: Record<string, string | number | boolean>
  totalProposals?: number
  proposalId?: string
  content?: string
  overallScore?: number
  votes?: DeliberationVote[]
  error?: string
}

interface A2AMessagePart {
  kind: 'data' | 'text' | 'error'
  data?: A2APartData
  text?: string
}

interface A2AJsonRpcResponse {
  jsonrpc: string
  id: number | string
  result?: {
    parts: A2AMessagePart[]
  }
  error?: {
    code: number
    message: string
  }
}

type A2AParams = Record<string, string | number | boolean>

const sendA2A = async (
  request: APIRequestContext,
  skillId: string,
  params?: A2AParams,
): Promise<A2AJsonRpcResponse> => {
  const response = await request.post(`${AUTOCRAT_URL}/a2a`, {
    data: {
      jsonrpc: '2.0',
      id: Date.now() + Math.random(),
      method: 'message/send',
      params: {
        message: {
          messageId: `conc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          parts: [{ kind: 'data', data: { skillId, params: params ?? {} } }],
        },
      },
    },
  })
  return response.json()
}

test.describe('Parallel Request Handling', () => {
  test('handles 20 concurrent health checks', async ({ request }) => {
    const requests = Array.from({ length: 20 }, () =>
      request.get(`${AUTOCRAT_URL}/health`),
    )

    const responses = await Promise.all(requests)

    for (const response of responses) {
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.status).toBe('ok')
    }
  })

  test('handles 10 concurrent A2A requests', async ({ request }) => {
    const requests = Array.from({ length: 10 }, () =>
      sendA2A(request, 'get-governance-stats'),
    )

    const results = await Promise.all(requests)

    for (const result of results) {
      expect(result.result).toBeDefined()
      const dataPart = result.result?.parts.find(
        (p: A2AMessagePart) => p.kind === 'data',
      )
      expect(dataPart?.data?.totalProposals).toBeDefined()
    }
  })

  test('handles mixed concurrent operations', async ({ request }) => {
    const operations = [
      sendA2A(request, 'get-governance-stats'),
      sendA2A(request, 'get-autocrat-status'),
      sendA2A(request, 'get-ceo-status'),
      request.get(`${AUTOCRAT_URL}/health`),
      request.post(`${AUTOCRAT_URL}/mcp/tools/list`),
      sendA2A(request, 'assess-proposal', {
        title: 'Concurrent Test',
        summary: 'Testing concurrent operations',
        description: 'This proposal is used for concurrency testing.',
      }),
    ]

    const results = await Promise.all(operations)

    expect(results.length).toBe(6)
    for (const result of results) {
      expect(result).toBeDefined()
    }
  })

  test('parallel deliberations do not interfere', async ({ request }) => {
    const proposals = Array.from({ length: 2 }, (_, i) => ({
      proposalId: `PARALLEL-${Date.now()}-${i}`,
      title: `Parallel Test Proposal ${i}`,
      description: `Testing parallel deliberation ${i}`,
      proposalType: 'GENERAL',
      submitter: `0x${i}${i}${i}`,
    }))

    const deliberations = proposals.map((p) =>
      sendA2A(request, 'deliberate', p),
    )
    const results = await Promise.all(deliberations)

    for (let i = 0; i < results.length; i++) {
      expect(results[i].result).toBeDefined()
      const dataPart = results[i].result?.parts.find(
        (p: A2AMessagePart) => p.kind === 'data',
      )
      const data = dataPart?.data
      expect(data).toBeDefined()

      if (data?.error && typeof data.error === 'string') {
        expect(data.error).toContain('Ollama')
      } else {
        expect(data?.proposalId).toBe(proposals[i].proposalId)
        expect(data?.votes).toBeDefined()
      }
    }
  })
})

test.describe('Rapid Sequential Requests', () => {
  test('handles 50 rapid sequential A2A calls', async ({ request }) => {
    const results: A2AJsonRpcResponse[] = []

    for (let i = 0; i < 50; i++) {
      const result = await sendA2A(request, 'get-autocrat-status')
      results.push(result)
    }

    expect(results.length).toBe(50)
    for (const result of results) {
      expect(result.result).toBeDefined()
    }
  })

  test('vote submissions in rapid succession', async ({ request }) => {
    const baseProposalId = `RAPID-VOTE-${Date.now()}`
    const agents = ['treasury', 'code', 'community', 'security', 'legal']

    for (let i = 0; i < 20; i++) {
      const agent = agents[i % agents.length]
      const vote = i % 3 === 0 ? 'APPROVE' : i % 3 === 1 ? 'REJECT' : 'ABSTAIN'

      const result = await sendA2A(request, 'submit-vote', {
        proposalId: `${baseProposalId}-${i}`,
        agentId: agent,
        vote,
        reasoning: `Rapid vote ${i}`,
        confidence: 50 + (i % 50),
      })

      expect(result.result).toBeDefined()
    }
  })

  test('alternating read/write operations', async ({ request }) => {
    const proposalId = `RW-${Date.now()}`

    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) {
        await sendA2A(request, 'add-commentary', {
          proposalId,
          content: `Comment ${i}`,
          sentiment: 'neutral',
        })
      } else {
        await sendA2A(request, 'get-governance-stats')
      }
    }

    const result = await sendA2A(request, 'get-governance-stats')
    expect(result.result).toBeDefined()
  })
})

test.describe('Request Ordering & Consistency', () => {
  test('responses correspond to correct requests', async ({ request }) => {
    const requests = Array.from({ length: 10 }, (_, i) => ({
      id: `ORDER-${i}-${Date.now()}`,
      index: i,
    }))

    const promises = requests.map((r) =>
      sendA2A(request, 'add-commentary', {
        proposalId: r.id,
        content: `Content for ${r.id}`,
        sentiment: r.index % 2 === 0 ? 'positive' : 'negative',
      }),
    )

    const results = await Promise.all(promises)

    for (let i = 0; i < results.length; i++) {
      const dataPart = results[i].result?.parts.find(
        (p: A2AMessagePart) => p.kind === 'data',
      )
      const data = dataPart?.data
      expect(data?.proposalId).toBe(requests[i].id)
      expect(data?.content).toBe(`Content for ${requests[i].id}`)
    }
  })

  test('JSON-RPC ids are returned correctly', async ({ request }) => {
    const ids = [1, 42, 999, 'string-id', 'uuid-12345']

    const promises = ids.map((id) =>
      request.post(`${AUTOCRAT_URL}/a2a`, {
        data: {
          jsonrpc: '2.0',
          id,
          method: 'message/send',
          params: {
            message: {
              messageId: `id-test-${id}`,
              parts: [
                { kind: 'data', data: { skillId: 'get-governance-stats' } },
              ],
            },
          },
        },
      }),
    )

    const responses = await Promise.all(promises)
    const results = await Promise.all(responses.map((r) => r.json()))

    for (let i = 0; i < results.length; i++) {
      expect(results[i].id).toBe(ids[i])
    }
  })
})

test.describe('Error Recovery', () => {
  test('server recovers after invalid request', async ({ request }) => {
    await request
      .post(`${AUTOCRAT_URL}/a2a`, { data: 'not valid json at all {' })
      .catch(() => null)

    const result = await sendA2A(request, 'get-governance-stats')
    expect(result.result).toBeDefined()
  })

  test('server handles request with missing fields gracefully', async ({
    request,
  }) => {
    const badResponse = await request.post(`${AUTOCRAT_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
      },
    })

    expect(badResponse.status()).toBeLessThan(500)

    const goodResult = await sendA2A(request, 'get-autocrat-status')
    expect(goodResult.result).toBeDefined()
  })

  test('handles burst of invalid followed by valid requests', async ({
    request,
  }) => {
    const invalidPromises = Array.from({ length: 5 }, () =>
      request.post(`${AUTOCRAT_URL}/a2a`, { data: {} }).catch(() => null),
    )
    await Promise.all(invalidPromises)

    const validPromises = Array.from({ length: 5 }, () =>
      sendA2A(request, 'get-governance-stats'),
    )
    const results = await Promise.all(validPromises)

    for (const result of results) {
      expect(result.result).toBeDefined()
    }
  })
})

test.describe('Memory & Resource Handling', () => {
  test('handles 100 requests without degradation', async ({ request }) => {
    const durations: number[] = []

    for (let i = 0; i < 100; i++) {
      const start = Date.now()
      await sendA2A(request, 'get-autocrat-status')
      durations.push(Date.now() - start)
    }

    const firstTen = durations.slice(0, 10)
    const lastTen = durations.slice(-10)

    const avgFirst = firstTen.reduce((a, b) => a + b, 0) / 10
    const avgLast = lastTen.reduce((a, b) => a + b, 0) / 10

    expect(avgLast).toBeLessThan(avgFirst * 3)
  })

  test('large batch of assessments does not exhaust resources', async ({
    request,
  }) => {
    const assessments = Array.from({ length: 20 }, (_, i) =>
      sendA2A(request, 'assess-proposal', {
        title: `Batch proposal ${i}`,
        summary: `Summary for batch proposal ${i}`,
        description: `Description for batch proposal ${i} with some content.`,
      }),
    )

    const results = await Promise.all(assessments)

    for (const result of results) {
      expect(result.result).toBeDefined()
      const dataPart = result.result?.parts.find(
        (p: A2AMessagePart) => p.kind === 'data',
      )
      expect(dataPart?.data?.overallScore).toBeDefined()
    }
  })
})
