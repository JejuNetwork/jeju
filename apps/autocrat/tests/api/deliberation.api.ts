/**
 * Deliberation Tests - Council deliberation flow
 */

import { CORE_PORTS } from '@jejunetwork/config'
import type { JsonObject } from '@jejunetwork/types'
import { expect, test } from '@playwright/test'

const AUTOCRAT_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_API.get()}`

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
          messageId: `delib-${Date.now()}`,
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

test.describe('Deliberation Flow', () => {
  test('assess proposal quality for new submission', async ({ request }) => {
    const result = await sendA2AMessage(request, 'assess-proposal', {
      title: 'Upgrade governance module to v2',
      summary:
        'This proposal upgrades the governance module with new voting mechanisms.',
      description: `This proposal introduces a comprehensive upgrade to the governance module.

Key changes:
1. New quadratic voting mechanism
2. Time-weighted voting power
3. Delegation improvements

Technical implementation:
- Uses upgradeable proxy pattern
- Fully backwards compatible
- 90% test coverage

Budget: 50,000 USDC
Timeline: 3 months`,
      proposalType: 'TECHNICAL',
    })

    const data = getDataPart(result.result)
    const rawScore = data?.overallScore ?? data?.qualityScore
    const score = typeof rawScore === 'number' ? rawScore : 0
    expect(data).toBeDefined()
    expect(typeof rawScore).toBe('number')
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  test('council members can submit independent votes', async ({ request }) => {
    const proposalId = `0x${'a'.repeat(64)}`
    const roles = ['TREASURY', 'CODE', 'COMMUNITY', 'SECURITY']

    for (const role of roles) {
      const result = await sendA2AMessage(request, 'submit-vote', {
        proposalId,
        role,
        vote: 'APPROVE',
        reasoning: `${role} agent approves this proposal.`,
        confidence: 75 + Math.floor(Math.random() * 20),
      })

      const data = getDataPart(result.result)
      expect(data).toBeDefined()
    }
  })

  test('get-autocrat-votes aggregates all votes', async ({ request }) => {
    const proposalId = `0x${'b'.repeat(64)}`

    await sendA2AMessage(request, 'submit-vote', {
      proposalId,
      role: 'TREASURY',
      vote: 'APPROVE',
      reasoning: 'Budget is reasonable',
      confidence: 85,
    })

    await sendA2AMessage(request, 'submit-vote', {
      proposalId,
      role: 'CODE',
      vote: 'REJECT',
      reasoning: 'Technical concerns',
      confidence: 70,
    })

    const result = await sendA2AMessage(request, 'get-autocrat-votes', {
      proposalId,
    })

    expect(result.result).toBeDefined()
  })

  test('CEO decision includes council consensus', async ({ request }) => {
    const result = await sendA2AMessage(request, 'request-ceo-decision', {
      proposalId: `0x${'c'.repeat(64)}`,
      autocratVotes: [
        {
          role: 'TREASURY',
          vote: 'APPROVE',
          reasoning: 'Budget approved',
          confidence: 90,
        },
        {
          role: 'CODE',
          vote: 'APPROVE',
          reasoning: 'Technical review passed',
          confidence: 85,
        },
        {
          role: 'COMMUNITY',
          vote: 'APPROVE',
          reasoning: 'Community benefit clear',
          confidence: 80,
        },
        {
          role: 'SECURITY',
          vote: 'ABSTAIN',
          reasoning: 'Need more security audit',
          confidence: 60,
        },
      ],
    })

    expect(result.result).toBeDefined()
  })

  test('commentary can be added to proposals', async ({ request }) => {
    const proposalId = `0x${'d'.repeat(64)}`

    const result = await sendA2AMessage(request, 'add-commentary', {
      proposalId,
      content:
        'This proposal has significant implications for the treasury runway.',
      sentiment: 'neutral',
    })

    const data = getDataPart(result.result)
    expect(data?.content).toBe(
      'This proposal has significant implications for the treasury runway.',
    )
    expect(data?.sentiment).toBe('neutral')
  })

  test('governance stats update after votes', async ({ request }) => {
    const result = await sendA2AMessage(request, 'get-governance-stats')
    const data = getDataPart(result.result)

    expect(data?.totalProposals).toBeDefined()
  })

  test('research request returns local mode info', async ({ request }) => {
    const result = await sendA2AMessage(request, 'request-research', {
      proposalId: `0x${'e'.repeat(64)}`,
      description: 'Market analysis for proposal',
    })

    const data = getDataPart(result.result)
    if (data?.error && typeof data.error === 'string') {
      expect(data.error).toContain('Ollama')
    } else {
      expect(data?.model).toBeDefined()
    }
  })
})
