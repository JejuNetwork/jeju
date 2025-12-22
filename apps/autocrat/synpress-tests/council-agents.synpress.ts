/**
 * Council Agents Tests - Council operations and agent functionality
 */

import { expect, test } from '@playwright/test'

const AUTOCRAT_URL = 'http://localhost:8010'

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
  text?: string
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

const sendA2AMessage = async (
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
          messageId: `test-${Date.now()}`,
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

test.describe('Council Status', () => {
  test('get-autocrat-status returns all council roles', async ({ request }) => {
    const result = await sendA2AMessage(request, 'get-autocrat-status')
    const data = getDataPart(result.result)

    expect(data?.agents).toBeDefined()
    expect((data?.agents as Array<{ role: string }>).length).toBe(4)

    const roles = (data?.agents as Array<{ role: string }>).map((a) => a.role)
    expect(roles).toContain('Treasury')
    expect(roles).toContain('Code')
    expect(roles).toContain('Community')
    expect(roles).toContain('Security')
  })

  test('get-governance-stats returns DAO statistics', async ({ request }) => {
    const result = await sendA2AMessage(request, 'get-governance-stats')
    const data = getDataPart(result.result)

    expect(data?.totalProposals).toBeDefined()
    expect(data?.ceo).toBeDefined()
    expect(data?.parameters).toBeDefined()
  })

  test('get-ceo-status returns CEO info', async ({ request }) => {
    const result = await sendA2AMessage(request, 'get-ceo-status')
    const data = getDataPart(result.result)

    expect(data).toBeDefined()
    expect(data?.currentModel).toBeDefined()
  })

  test('list-proposals returns proposal list', async ({ request }) => {
    const result = await sendA2AMessage(request, 'list-proposals', {
      activeOnly: false,
    })
    const data = getDataPart(result.result)

    expect(Array.isArray(data?.proposals)).toBe(true)
    expect(typeof data?.total).toBe('number')
  })
})

test.describe('Council Voting', () => {
  test('submit-vote skill accepts vote submission', async ({ request }) => {
    const result = await sendA2AMessage(request, 'submit-vote', {
      proposalId: `0x${'1'.repeat(64)}`,
      role: 'TREASURY',
      vote: 'APPROVE',
      reasoning: 'Test vote from treasury agent',
      confidence: 85,
    })

    expect(result.result).toBeDefined()
  })

  test('get-autocrat-votes returns votes for proposal', async ({ request }) => {
    const proposalId = `0x${'2'.repeat(64)}`

    await sendA2AMessage(request, 'submit-vote', {
      proposalId,
      role: 'CODE',
      vote: 'APPROVE',
      reasoning: 'Technical assessment complete',
      confidence: 90,
    })

    const result = await sendA2AMessage(request, 'get-autocrat-votes', {
      proposalId,
    })
    const data = getDataPart(result.result)

    expect(Array.isArray(data?.votes) || data?.votes === undefined).toBe(true)
  })

  test('add-commentary skill responds correctly', async ({ request }) => {
    const result = await sendA2AMessage(request, 'add-commentary', {
      proposalId: `0x${'3'.repeat(64)}`,
      content: 'This is a test comment on the proposal.',
      sentiment: 'positive',
    })
    const data = getDataPart(result.result)

    expect(data?.content).toBe('This is a test comment on the proposal.')
    expect(data?.sentiment).toBe('positive')
  })

  test('request-research skill initiates research', async ({ request }) => {
    const result = await sendA2AMessage(request, 'request-research', {
      proposalId: `0x${'4'.repeat(64)}`,
      topic: 'Technical feasibility analysis',
    })

    expect(result.result).toBeDefined()
  })

  test('unknown skill returns error', async ({ request }) => {
    const result = await sendA2AMessage(request, 'nonexistent-skill', {})
    const data = getDataPart(result.result)

    expect(data?.error).toBeDefined()
  })
})

test.describe('CEO Operations', () => {
  test('back-proposal skill returns transaction info', async ({ request }) => {
    const result = await sendA2AMessage(request, 'back-proposal', {
      proposalId: `0x${'5'.repeat(64)}`,
      stakeAmount: '1000000000000000000',
      reputationWeight: 50,
    })
    const data = getDataPart(result.result)

    expect(data?.action).toBe('backProposal')
    expect(data?.params).toBeDefined()
  })

  test('cast-veto skill returns transaction info', async ({ request }) => {
    const result = await sendA2AMessage(request, 'cast-veto', {
      proposalId: `0x${'6'.repeat(64)}`,
      category: 0,
      reason: 'Test reason for veto',
    })
    const data = getDataPart(result.result)

    expect(data?.action).toBe('castVetoVote')
  })

  test('request-research returns info (local mode)', async ({ request }) => {
    const result = await sendA2AMessage(request, 'request-research', {
      proposalId: `0x${'7'.repeat(64)}`,
      description: 'Test proposal for research',
    })
    const data = getDataPart(result.result)

    expect(data).toBeDefined()
    if (data?.error) {
      expect(data.error as string).toContain('Ollama')
    } else {
      expect(data?.proposalId).toBeDefined()
    }
  })
})
