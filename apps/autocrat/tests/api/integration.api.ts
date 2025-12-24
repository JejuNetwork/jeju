/**
 * Integration Tests - Full workflows with real dependencies
 */

import { expect, test } from '@playwright/test'

const AUTOCRAT_URL = 'http://localhost:8010'
const RPC_URL = process.env.RPC_URL ?? 'http://localhost:6546'

/** JSON-serializable primitive */
type JsonPrimitive = string | number | boolean | null

/** JSON-serializable value */
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/** JSON object */
type JsonObject = { [key: string]: JsonValue }

interface A2ADataPart {
  kind: 'data'
  data: JsonObject
}

interface A2APart {
  kind: string
  data?: JsonObject
}

interface A2AJsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: {
    message: {
      messageId: string
      parts: Array<{ kind: string; data: JsonObject }>
    }
  }
}

const sendA2A = async (
  request: {
    post: (
      url: string,
      options: { data: A2AJsonRpcRequest },
    ) => Promise<{ json: () => Promise<{ result?: { parts: A2APart[] } }> }>
  },
  skillId: string,
  params?: JsonObject,
) => {
  const response = await request.post(`${AUTOCRAT_URL}/a2a`, {
    data: {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'message/send',
      params: {
        message: {
          messageId: `int-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          parts: [{ kind: 'data', data: { skillId, params: params ?? {} } }],
        },
      },
    },
  })
  return response.json()
}

const getDataPart = (
  result: { parts: A2APart[] } | undefined,
): A2ADataPart['data'] | undefined => {
  return result?.parts.find((p): p is A2ADataPart => p.kind === 'data')?.data
}

test.describe('Full Proposal Lifecycle', () => {
  test('complete proposal flow: assess -> submit -> deliberate -> decision', async ({
    request,
  }) => {
    const proposalId = `LIFECYCLE-${Date.now()}`

    const assessResult = await sendA2A(request, 'assess-proposal', {
      title: 'Lifecycle Test: Treasury Optimization',
      summary:
        'A comprehensive test proposal covering all aspects of the lifecycle flow.',
      description: `## Problem
The current treasury management lacks optimization.

## Solution
Implement automated treasury rebalancing using DeFi protocols.

## Implementation
1. Smart contract development
2. Integration with Aave/Compound
3. Automated triggers

## Timeline
- Week 1-2: Development
- Week 3: Audit
- Week 4: Deployment

## Cost
Total: 75 ETH

## Benefit
- 15% APY improvement
- Reduced manual management

## Risk Assessment
- Smart contract risk: Mitigated by audits
- Market risk: Diversified positions`,
    })

    const assessData = getDataPart(assessResult.result)
    expect(assessData?.overallScore).toBeDefined()
    const qualityScore = assessData?.overallScore as number

    if (qualityScore >= 90) {
      const submitResult = await sendA2A(request, 'submit-proposal', {
        proposalType: 1,
        qualityScore,
        contentHash: `0x${proposalId.padEnd(64, '0').slice(0, 64)}`,
      })

      const submitData = getDataPart(submitResult.result)
      expect(submitData?.action).toBe('submitProposal')
    }

    const deliberateResult = await sendA2A(request, 'deliberate', {
      proposalId,
      title: 'Lifecycle Test: Treasury Optimization',
      description: 'Test proposal for lifecycle verification',
      proposalType: 'TREASURY_ALLOCATION',
      submitter: '0x1234',
    })

    const deliberateData = getDataPart(deliberateResult.result)
    expect(deliberateData?.votes).toBeDefined()
    expect((deliberateData?.votes as Array<unknown>).length).toBe(5)
    expect(deliberateData?.recommendation).toBeDefined()

    const decisionResult = await sendA2A(request, 'ceo-decision', {
      proposalId,
    })

    const decisionData = getDataPart(decisionResult.result)
    expect(typeof decisionData?.approved).toBe('boolean')
    expect(decisionData?.reasoning).toBeDefined()
    expect(Array.isArray(decisionData?.recommendations)).toBe(true)
  })
})

test.describe('Orchestrator Integration', () => {
  test('trigger endpoint runs orchestrator cycle', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/trigger/orchestrator`,
      {
        data: { action: 'run-cycle' },
      },
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(typeof data.cycleCount).toBe('number')
    expect(data.cycleCount).toBeGreaterThanOrEqual(0)
  })

  test('orchestrator status reflects current state', async ({ request }) => {
    const response = await request.get(
      `${AUTOCRAT_URL}/api/v1/orchestrator/status`,
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    expect(typeof data.running).toBe('boolean')
    expect(typeof data.cycleCount).toBe('number')
  })

  test('trigger list shows available triggers', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/api/v1/triggers`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()

    expect(data.mode).toBeDefined()
    expect(['local', 'compute']).toContain(data.mode)
  })

  test('multiple trigger executions complete successfully', async ({
    request,
  }) => {
    const results = []
    for (let i = 0; i < 3; i++) {
      const triggerResult = await request.post(
        `${AUTOCRAT_URL}/trigger/orchestrator`,
      )
      expect(triggerResult.ok()).toBeTruthy()
      const data = await triggerResult.json()
      results.push(data)
    }

    for (const result of results) {
      expect(result.success).toBe(true)
    }
  })
})

test.describe('REST API Integration', () => {
  test('GET /api/v1/proposals returns list', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/api/v1/proposals`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(Array.isArray(data.proposals) || data.total !== undefined).toBe(true)
  })

  test('GET /api/v1/proposals?active=true filters active only', async ({
    request,
  }) => {
    const allResponse = await request.get(`${AUTOCRAT_URL}/api/v1/proposals`)
    const activeResponse = await request.get(
      `${AUTOCRAT_URL}/api/v1/proposals?active=true`,
    )

    expect(allResponse.ok()).toBeTruthy()
    expect(activeResponse.ok()).toBeTruthy()

    const allData = await allResponse.json()
    const activeData = await activeResponse.json()

    const allCount = allData.total ?? allData.proposals?.length ?? 0
    const activeCount = activeData.total ?? activeData.proposals?.length ?? 0
    expect(activeCount).toBeLessThanOrEqual(allCount)
  })

  test('GET /api/v1/ceo returns status', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/api/v1/ceo`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.currentModel || data.model).toBeDefined()
  })

  test('GET /api/v1/governance/stats returns stats', async ({ request }) => {
    const response = await request.get(
      `${AUTOCRAT_URL}/api/v1/governance/stats`,
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.totalProposals).toBeDefined()
    expect(data.ceo).toBeDefined()
    expect(data.parameters).toBeDefined()
  })
})

test.describe('Real Blockchain Integration', () => {
  test.beforeAll(async () => {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_chainId',
          params: [],
        }),
      })
      if (!response.ok) test.skip()
    } catch {
      test.skip()
    }
  })

  test('RPC endpoint responds', async () => {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: [],
      }),
    })
    expect(response.ok).toBeTruthy()
    const data = await response.json()
    expect(data.result).toBeDefined()
  })

  test('council connects to live chain', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/health`)
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.status).toBe('ok')
  })

  test('governance stats reflect chain state', async ({ request }) => {
    const result = await sendA2A(request, 'get-governance-stats')
    const data = getDataPart(result.result)
    expect(data?.totalProposals).toBeDefined()
  })
})

test.describe('Health and Status', () => {
  test('health endpoint reflects actual service state', async ({ request }) => {
    const healthResponse = await request.get(`${AUTOCRAT_URL}/health`)
    expect(healthResponse.ok()).toBeTruthy()
    const health = await healthResponse.json()

    expect(health.status).toBe('ok')
    expect(health.service).toBe('jeju-autocrat')
    expect(typeof health.orchestrator).toBe('boolean')
  })

  test('all documented endpoints are accessible', async ({ request }) => {
    const endpoints = [
      {
        path: '/api/v1/proposals/quick-score',
        method: 'POST',
        data: { title: 'Test', description: 'Test' },
        mustOk: true,
      },
      {
        path: '/api/v1/research/quick-screen',
        method: 'POST',
        data: { proposalId: '0x1', title: 'Test', description: 'Test' },
        mustOk: true,
      },
      { path: '/api/v1/moderation/leaderboard', method: 'GET', mustOk: true },
      { path: '/api/v1/agents/count', method: 'GET', mustOk: true },
      { path: '/api/v1/futarchy/parameters', method: 'GET', mustOk: false },
    ]

    for (const endpoint of endpoints) {
      const response =
        endpoint.method === 'GET'
          ? await request.get(`${AUTOCRAT_URL}${endpoint.path}`)
          : await request.post(`${AUTOCRAT_URL}${endpoint.path}`, {
              data: endpoint.data,
            })

      if (endpoint.mustOk) {
        expect(response.ok()).toBeTruthy()
      } else {
        expect([200, 404]).toContain(response.status())
      }
    }
  })

  test('A2A endpoint is accessible', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'agent/card',
        params: {},
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.result || data.error).toBeDefined()
  })
})
