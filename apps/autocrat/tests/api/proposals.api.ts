/**
 * Proposals Tests - Proposal quality assessment and submission
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

interface A2AResult {
  result?: { parts: A2APart[] }
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

function expectResult(response: A2AResult): { parts: A2APart[] } {
  if (!response.result) {
    throw new Error('Expected A2A result')
  }
  return response.result
}

function expectDataPart(result: { parts: A2APart[] }): JsonObject {
  const dataPart = result.parts.find((p): p is A2ADataPart => p.kind === 'data')
  if (!dataPart) {
    throw new Error('Expected data part in result')
  }
  return dataPart.data
}

const sendA2AMessage = async (
  request: {
    post: (
      url: string,
      options: { data: A2AJsonRpcRequest },
    ) => Promise<{ json: () => Promise<A2AResult> }>
  },
  skillId: string,
  params: JsonObject,
): Promise<A2AResult> => {
  const response = await request.post(`${AUTOCRAT_URL}/a2a`, {
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: {
        message: {
          messageId: `msg-${Date.now()}`,
          parts: [{ kind: 'data', data: { skillId, params } }],
        },
      },
    },
  })
  return response.json()
}

test.describe('Proposal Quality Assessment', () => {
  test('low quality proposal gets low score', async ({ request }) => {
    const response = await sendA2AMessage(request, 'assess-proposal', {
      title: 'Bad',
      summary: 'Short',
      description: 'Not enough detail',
      proposalType: 'GRANT',
    })

    const data = expectDataPart(expectResult(response))
    expect(data.overallScore as number).toBeLessThan(90)
    expect(data.readyToSubmit).toBe(false)
  })

  test('comprehensive proposal gets better score', async ({ request }) => {
    const response = await sendA2AMessage(request, 'assess-proposal', {
      title: 'Implement Cross-Chain Bridge Integration for Ecosystem Growth',
      summary:
        'This proposal integrates cross-chain bridge functionality to enable seamless asset transfers across multiple blockchain networks.',
      description: `
## Problem
Currently, users face friction when moving assets between chains.

## Solution
Implement a secure cross-chain bridge with support for major networks.

## Implementation
1. Deploy bridge contracts on target chains
2. Set up relayer infrastructure
3. Build frontend integration
4. Security audits

## Timeline
- Week 1-2: Contract development
- Week 3: Testing and audits
- Week 4: Deployment

## Cost
- Development: 50 ETH
- Audits: 30 ETH
- Infrastructure: 20 ETH

## Benefit
- 50% increase in TVL expected
- Better member experience

## Risk Assessment
- Smart contract risk: Mitigated by audits
- Bridge security: Multi-sig controls
      `,
      proposalType: 'CODE_UPGRADE',
    })

    const data = expectDataPart(expectResult(response))
    expect(data.overallScore as number).toBeGreaterThanOrEqual(70)
    expect(data.criteria).toBeDefined()
    const criteria = data.criteria as { clarity: number }
    expect(criteria.clarity).toBeGreaterThan(50)
  })

  test('assessment returns all quality criteria', async ({ request }) => {
    const response = await sendA2AMessage(request, 'assess-proposal', {
      title: 'Test Proposal',
      summary: 'A test proposal with enough content to be evaluated properly.',
      description:
        'This is a test proposal with problem, solution, implementation.',
      proposalType: 'GRANT',
    })

    const data = expectDataPart(expectResult(response))
    const criteria = data.criteria as Record<string, number>
    expect(criteria.clarity).toBeDefined()
    expect(criteria.completeness).toBeDefined()
    expect(criteria.feasibility).toBeDefined()
    expect(criteria.alignment).toBeDefined()
    expect(criteria.impact).toBeDefined()
    expect(criteria.riskAssessment).toBeDefined()
    expect(criteria.costBenefit).toBeDefined()
  })
})

test.describe('Proposal Assistant API', () => {
  test('assess proposal with complete content', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/proposals/assess`,
      {
        data: {
          title: 'Implement Cross-Chain Bridge',
          summary: 'Enable asset transfers between networks.',
          description: `
## Problem
The network operates in isolation, limiting liquidity.

## Solution
Implement a trustless bridge using MPC signatures.

## Timeline
- Month 1: Development
- Month 2: Audits
- Month 3: Deployment

## Budget
- Development: 50,000 USDC
- Audits: 20,000 USDC

## Risks
- Smart contract vulnerabilities: Mitigated by audits
        `,
          proposalType: 2,
        },
      },
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.overallScore).toBeGreaterThan(60)
    expect(data.criteria).toHaveProperty('clarity')
    expect(data.criteria).toHaveProperty('completeness')
    expect(data.assessedBy).toMatch(/ollama|heuristic/)
  })

  test('low-quality proposal gets low score', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/proposals/assess`,
      {
        data: {
          title: 'Do stuff',
          description: 'Make things better.',
          proposalType: 0,
        },
      },
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.overallScore).toBeLessThan(50)
    expect(data.readyToSubmit).toBe(false)
  })

  test('quick-score returns score and content hash', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/proposals/quick-score`,
      {
        data: {
          title: 'Test Proposal',
          summary: 'A test proposal for the DAO governance system.',
          description: 'This proposal addresses the problem of testing.',
          proposalType: 0,
        },
      },
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.score).toBeGreaterThanOrEqual(0)
    expect(data.score).toBeLessThanOrEqual(100)
    expect(data.contentHash).toMatch(/^0x[a-f0-9]{64}$/)
  })

  test('generate proposal from idea', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/proposals/generate`,
      {
        data: {
          idea: 'Create a grants program to fund open-source development',
          proposalType: 6,
        },
      },
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.title).toBeTruthy()
    expect(data.description).toBeTruthy()
    expect(data.proposalType).toBe(6)
  })

  test('improve proposal returns suggestions', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/proposals/improve`,
      {
        data: {
          draft: {
            title: 'Simple Proposal',
            description: 'A basic proposal without much detail.',
            proposalType: 0,
          },
          criterion: 'completeness',
        },
      },
    )

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.improved).toBeTruthy()
    expect(data.improved.length).toBeGreaterThan(0)
  })

  test('missing title returns error', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/proposals/assess`,
      {
        data: { description: 'No title provided' },
      },
    )

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('title')
  })
})
