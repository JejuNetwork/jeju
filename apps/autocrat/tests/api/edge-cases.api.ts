/**
 * Edge Cases Tests - Boundary conditions, invalid inputs, and error scenarios
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
          messageId: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

test.describe('Empty & Null Input Handling', () => {
  test('assess-proposal with empty strings', async ({ request }) => {
    const result = await sendA2A(request, 'assess-proposal', {
      title: '',
      summary: '',
      description: '',
    })

    const data = getDataPart(result.result)
    const score = typeof data?.overallScore === 'number' ? data.overallScore : 0
    expect(score).toBeLessThan(50)
    expect(data?.readyToSubmit).toBe(false)
  })

  test('assess-proposal with undefined params', async ({ request }) => {
    const result = await sendA2A(request, 'assess-proposal', {})

    const data = getDataPart(result.result)
    expect(data?.overallScore).toBeDefined()
  })

  test('submit-vote with missing required fields', async ({ request }) => {
    const result = await sendA2A(request, 'submit-vote', {
      proposalId: `0x${'f'.repeat(64)}`,
    })

    const data = getDataPart(result.result)
    expect(data?.error).toBeDefined()
  })

  test('get-proposal with empty proposalId', async ({ request }) => {
    const result = await sendA2A(request, 'get-proposal', { proposalId: '' })

    const data = getDataPart(result.result)
    expect(data?.error).toBeDefined()
  })

  test('chat with empty message', async ({ request }) => {
    const result = await sendA2A(request, 'chat', { message: '' })

    const data = getDataPart(result.result)
    expect(data?.error).toBeDefined()
  })
})

test.describe('Boundary Value Testing', () => {
  test('assess-proposal with maximum length content', async ({ request }) => {
    const longTitle = 'A'.repeat(1000)
    const longSummary = 'B'.repeat(5000)
    const longDescription = 'C'.repeat(50000)

    const result = await sendA2A(request, 'assess-proposal', {
      title: longTitle,
      summary: longSummary,
      description: longDescription,
    })

    const data = getDataPart(result.result)
    expect(data?.overallScore).toBeDefined()
    expect(typeof data?.overallScore).toBe('number')
  })

  test('submit-vote with confidence at boundaries', async ({ request }) => {
    const proposalId = `0x${'1'.repeat(64)}`

    const resultZero = await sendA2A(request, 'submit-vote', {
      proposalId,
      agentId: 'treasury',
      vote: 'APPROVE',
      reasoning: 'Zero confidence test',
      confidence: 0,
    })
    expect(resultZero.result).toBeDefined()

    const resultMax = await sendA2A(request, 'submit-vote', {
      proposalId,
      agentId: 'code',
      vote: 'REJECT',
      reasoning: 'Max confidence test',
      confidence: 100,
    })
    expect(resultMax.result).toBeDefined()

    const resultOver = await sendA2A(request, 'submit-vote', {
      proposalId,
      agentId: 'security',
      vote: 'ABSTAIN',
      reasoning: 'Over limit test',
      confidence: 150,
    })
    expect(resultOver.result).toBeDefined()
  })

  test('submit-proposal with quality score at threshold', async ({
    request,
  }) => {
    const result90 = await sendA2A(request, 'submit-proposal', {
      proposalType: 1,
      qualityScore: 90,
      contentHash: `0x${'a'.repeat(64)}`,
    })
    const data90 = getDataPart(result90.result)
    expect(data90?.error).toBeUndefined()

    const result89 = await sendA2A(request, 'submit-proposal', {
      proposalType: 1,
      qualityScore: 89,
      contentHash: `0x${'b'.repeat(64)}`,
    })
    const data89 = getDataPart(result89.result)
    expect(data89?.error).toBeDefined()
  })
})

test.describe('Invalid Input Types', () => {
  test('assess-proposal with non-string values handles gracefully', async ({
    request,
  }) => {
    const result = await sendA2A(request, 'assess-proposal', {
      title: 12345,
      summary: 'Valid summary text',
      description: 'Valid description text',
    })

    expect(result).toBeDefined()
    if (result.result) {
      const data = getDataPart(result.result)
      expect(data?.overallScore ?? data?.error).toBeDefined()
    }
  })

  test('submit-vote with invalid vote value', async ({ request }) => {
    const result = await sendA2A(request, 'submit-vote', {
      proposalId: `0x${'2'.repeat(64)}`,
      agentId: 'treasury',
      vote: 'MAYBE',
      reasoning: 'Testing invalid vote',
      confidence: 50,
    })

    const data = getDataPart(result.result)
    expect(data?.error).toBeDefined()
  })

  test('submit-vote with invalid agent', async ({ request }) => {
    const result = await sendA2A(request, 'submit-vote', {
      proposalId: `0x${'3'.repeat(64)}`,
      agentId: 'invalid-agent',
      vote: 'APPROVE',
      reasoning: 'Testing invalid agent',
      confidence: 50,
    })

    const data = getDataPart(result.result)
    expect(data?.error).toBeDefined()
  })

  test('unknown skill returns error', async ({ request }) => {
    const result = await sendA2A(request, 'nonexistent-skill', {})

    const data = getDataPart(result.result)
    const errorMsg = typeof data?.error === 'string' ? data.error : ''
    expect(errorMsg).toContain('not found')
  })
})

test.describe('Malformed Request Handling', () => {
  test('missing jsonrpc version', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/a2a`, {
      data: {
        id: 1,
        method: 'message/send',
        params: { message: { messageId: 'test', parts: [] } },
      },
    })

    expect(response.status()).toBeLessThan(500)
  })

  test('invalid JSON-RPC method', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'invalid/method',
        params: {},
      },
    })

    const result = await response.json()
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe(-32601)
  })

  test('missing message parts', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: { message: { messageId: 'test' } },
      },
    })

    const result = await response.json()
    expect(result.error).toBeDefined()
  })

  test('empty request body', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/a2a`, {
      headers: { 'Content-Type': 'application/json' },
      data: '',
    })

    expect(response.status()).toBeLessThan(500)
  })
})

test.describe('Special Characters & Unicode', () => {
  test('assess-proposal with unicode content', async ({ request }) => {
    const result = await sendA2A(request, 'assess-proposal', {
      title: '提案：改善社区治理 🏛️',
      summary: '这是一个关于社区治理改进的提案 📋',
      description: `## 问题描述
社区治理需要改进。

## 解决方案
实施新的投票机制。

## 时间线 ⏰
- 第一周: 设计
- 第二周: 实施

Emojis: 🚀 💎 🔥 ✨`,
    })

    const data = getDataPart(result.result)
    expect(data?.overallScore).toBeDefined()
  })

  test('chat with special characters', async ({ request }) => {
    const result = await sendA2A(request, 'chat', {
      message: `Hello! <script>alert('xss')</script> & "quotes" 'apostrophes' \n\t newlines`,
      agent: 'ceo',
    })

    expect(result.result).toBeDefined()
  })

  test('add-commentary with markdown', async ({ request }) => {
    const result = await sendA2A(request, 'add-commentary', {
      proposalId: `0x${'4'.repeat(64)}`,
      content: `# Header
**Bold** and *italic*
- List item
\`\`\`code block\`\`\`
[link](http://example.com)`,
      sentiment: 'positive',
    })

    const data = getDataPart(result.result)
    const content = typeof data?.content === 'string' ? data.content : ''
    expect(content).toContain('Header')
  })
})

test.describe('API Boundary Conditions', () => {
  test('empty title (boundary: 0 chars)', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/proposals/assess`,
      {
        data: { title: '', description: 'Valid description with content' },
      },
    )
    expect(response.status()).toBe(400)
  })

  test('minimal valid title (boundary: 1 char)', async ({ request }) => {
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/proposals/assess`,
      {
        data: {
          title: 'X',
          description:
            'A valid description that is long enough to be processed',
        },
      },
    )
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.overallScore).toBeLessThan(50)
  })

  test('very long title (boundary: 1000+ chars)', async ({ request }) => {
    const longTitle = 'A'.repeat(1000)
    const response = await request.post(
      `${AUTOCRAT_URL}/api/v1/proposals/assess`,
      {
        data: { title: longTitle, description: 'Valid description' },
      },
    )
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.criteria.clarity).toBeLessThan(80)
  })

  test('proposalType at boundaries (0 and 9)', async ({ request }) => {
    for (const proposalType of [0, 9]) {
      const response = await request.post(
        `${AUTOCRAT_URL}/api/v1/proposals/assess`,
        {
          data: {
            title: `Type ${proposalType} Test`,
            description: 'Testing proposal type boundaries',
            proposalType,
          },
        },
      )
      expect(response.ok()).toBeTruthy()
    }
  })

  test('quick-score returns consistent hash', async ({ request }) => {
    const data = {
      title: 'Hash Test',
      description: 'Testing hash consistency',
      proposalType: 0,
    }

    const r1 = await request.post(
      `${AUTOCRAT_URL}/api/v1/proposals/quick-score`,
      { data },
    )
    const r2 = await request.post(
      `${AUTOCRAT_URL}/api/v1/proposals/quick-score`,
      { data },
    )

    const d1 = await r1.json()
    const d2 = await r2.json()

    expect(d1.contentHash).toBe(d2.contentHash)
    expect(d1.score).toBe(d2.score)
  })
})
