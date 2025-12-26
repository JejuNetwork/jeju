/**
 * Indexer - MCP API E2E Tests
 *
 * Comprehensive tests for Model Context Protocol endpoints:
 * - Server initialization
 * - Resources listing and reading
 * - Tools listing and execution
 * - Prompts listing and retrieval
 * - Rate limiting and security
 */

import { expect, test } from '@playwright/test'

const MCP_BASE_URL = process.env.MCP_URL || 'http://localhost:4353'

test.describe('MCP Server Info', () => {
  test('GET / should return server info', async ({ request }) => {
    const response = await request.get(`${MCP_BASE_URL}/`)

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.server).toBe('jeju-indexer')
    expect(data.version).toBe('1.0.0')
    expect(data.description).toContain('Blockchain data indexing')
    expect(data.resources).toBeDefined()
    expect(data.tools).toBeDefined()
    expect(data.prompts).toBeDefined()
    expect(data.capabilities).toBeDefined()
  })

  test('should have resources, tools, and prompts capabilities', async ({
    request,
  }) => {
    const response = await request.get(`${MCP_BASE_URL}/`)
    const data = await response.json()

    expect(data.capabilities.resources).toBe(true)
    expect(data.capabilities.tools).toBe(true)
    expect(data.capabilities.prompts).toBe(true)
  })
})

test.describe('MCP Initialize', () => {
  test('POST /initialize should return protocol info', async ({ request }) => {
    const response = await request.post(`${MCP_BASE_URL}/initialize`, {
      data: {},
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.protocolVersion).toBe('2024-11-05')
    expect(data.serverInfo).toBeDefined()
    expect(data.serverInfo.name).toBe('jeju-indexer')
    expect(data.capabilities).toBeDefined()
  })
})

test.describe('MCP Resources', () => {
  test('POST /resources/list should return available resources', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/resources/list`, {
      data: {},
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.resources).toBeDefined()
    expect(Array.isArray(data.resources)).toBeTruthy()
    expect(data.resources.length).toBeGreaterThan(0)
  })

  test('should list all expected resources', async ({ request }) => {
    const response = await request.post(`${MCP_BASE_URL}/resources/list`, {
      data: {},
    })
    const data = await response.json()

    const resourceUris = data.resources.map((r: { uri: string }) => r.uri)
    expect(resourceUris).toContain('indexer://blocks/latest')
    expect(resourceUris).toContain('indexer://transactions/recent')
    expect(resourceUris).toContain('indexer://agents')
    expect(resourceUris).toContain('indexer://intents/active')
    expect(resourceUris).toContain('indexer://proposals/active')
    expect(resourceUris).toContain('indexer://stats/network')
  })

  test('POST /resources/read should read blocks/latest resource', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/resources/read`, {
      data: { uri: 'indexer://blocks/latest' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contents).toBeDefined()
    expect(Array.isArray(data.contents)).toBeTruthy()
    expect(data.contents[0].uri).toBe('indexer://blocks/latest')
    expect(data.contents[0].mimeType).toBe('application/json')

    const content = JSON.parse(data.contents[0].text)
    expect(content.query).toContain('blocks')
  })

  test('POST /resources/read should read transactions/recent resource', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/resources/read`, {
      data: { uri: 'indexer://transactions/recent' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contents[0].uri).toBe('indexer://transactions/recent')

    const content = JSON.parse(data.contents[0].text)
    expect(content.query).toContain('transactions')
  })

  test('POST /resources/read should read agents resource', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/resources/read`, {
      data: { uri: 'indexer://agents' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contents[0].uri).toBe('indexer://agents')

    const content = JSON.parse(data.contents[0].text)
    expect(content.query).toContain('registeredAgents')
  })

  test('POST /resources/read should read intents/active resource', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/resources/read`, {
      data: { uri: 'indexer://intents/active' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contents[0].uri).toBe('indexer://intents/active')
  })

  test('POST /resources/read should read proposals/active resource', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/resources/read`, {
      data: { uri: 'indexer://proposals/active' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contents[0].uri).toBe('indexer://proposals/active')
  })

  test('POST /resources/read should read stats/network resource', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/resources/read`, {
      data: { uri: 'indexer://stats/network' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contents[0].uri).toBe('indexer://stats/network')
  })

  test('POST /resources/read with unknown URI should return 404', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/resources/read`, {
      data: { uri: 'indexer://unknown/resource' },
    })

    expect(response.status()).toBe(404)
  })

  test('POST /resources/read without URI should return 400', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/resources/read`, {
      data: {},
    })

    expect(response.status()).toBe(400)
  })
})

test.describe('MCP Tools', () => {
  test('POST /tools/list should return available tools', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/list`, {
      data: {},
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.tools).toBeDefined()
    expect(Array.isArray(data.tools)).toBeTruthy()
    expect(data.tools.length).toBeGreaterThan(0)
  })

  test('should list all expected tools', async ({ request }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/list`, {
      data: {},
    })
    const data = await response.json()

    const toolNames = data.tools.map((t: { name: string }) => t.name)
    expect(toolNames).toContain('query_graphql')
    expect(toolNames).toContain('get_block')
    expect(toolNames).toContain('get_transaction')
    expect(toolNames).toContain('get_account')
    expect(toolNames).toContain('get_token_balances')
    expect(toolNames).toContain('get_agent')
    expect(toolNames).toContain('search_agents')
    expect(toolNames).toContain('get_intent')
    expect(toolNames).toContain('get_proposal')
    expect(toolNames).toContain('get_contract_events')
  })

  test('tools should have proper input schemas', async ({ request }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/list`, {
      data: {},
    })
    const data = await response.json()

    for (const tool of data.tools) {
      expect(tool.name).toBeDefined()
      expect(tool.description).toBeDefined()
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  test('POST /tools/call query_graphql should return query info', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'query_graphql',
        arguments: {
          query: '{ blocks(limit: 1) { number } }',
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.content).toBeDefined()
    expect(data.isError).toBe(false)

    const result = JSON.parse(data.content[0].text)
    expect(result.endpoint).toBe('/graphql')
    expect(result.method).toBe('POST')
    expect(result.body.query).toBeDefined()
  })

  test('POST /tools/call get_block by number should return query', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'get_block',
        arguments: { blockNumber: 1 },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.content).toBeDefined()
    expect(data.isError).toBe(false)

    const result = JSON.parse(data.content[0].text)
    expect(result.query).toContain('block')
  })

  test('POST /tools/call get_block by hash should return query', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'get_block',
        arguments: {
          blockHash:
            '0x1234567890123456789012345678901234567890123456789012345678901234',
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.isError).toBe(false)
  })

  test('POST /tools/call get_block without params should return 400', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'get_block',
        arguments: {},
      },
    })

    expect(response.status()).toBe(400)
  })

  test('POST /tools/call get_transaction should return query', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'get_transaction',
        arguments: {
          hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.isError).toBe(false)

    const result = JSON.parse(data.content[0].text)
    expect(result.query).toContain('transaction')
  })

  test('POST /tools/call get_account should return query', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'get_account',
        arguments: { address: '0x1234567890123456789012345678901234567890' },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.isError).toBe(false)
  })

  test('POST /tools/call get_token_balances should return query', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'get_token_balances',
        arguments: { address: '0x1234567890123456789012345678901234567890' },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.isError).toBe(false)
  })

  test('POST /tools/call get_agent should return query', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'get_agent',
        arguments: { agentId: '1' },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.isError).toBe(false)
  })

  test('POST /tools/call search_agents should return query', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'search_agents',
        arguments: { active: true, limit: 10 },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.isError).toBe(false)
  })

  test('POST /tools/call get_intent should return query', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'get_intent',
        arguments: { intentId: 'intent-123' },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.isError).toBe(false)
  })

  test('POST /tools/call get_proposal should return query', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'get_proposal',
        arguments: { proposalId: 'proposal-123' },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.isError).toBe(false)
  })

  test('POST /tools/call get_contract_events should return query', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'get_contract_events',
        arguments: {
          address: '0x1234567890123456789012345678901234567890',
          limit: 50,
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.isError).toBe(false)
  })

  test('POST /tools/call with unknown tool should return 400', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: {
        name: 'unknown_tool',
        arguments: {},
      },
    })

    expect(response.status()).toBe(400)
  })
})

test.describe('MCP Prompts', () => {
  test('POST /prompts/list should return available prompts', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/prompts/list`, {
      data: {},
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.prompts).toBeDefined()
    expect(Array.isArray(data.prompts)).toBeTruthy()
    expect(data.prompts.length).toBeGreaterThan(0)
  })

  test('should list all expected prompts', async ({ request }) => {
    const response = await request.post(`${MCP_BASE_URL}/prompts/list`, {
      data: {},
    })
    const data = await response.json()

    const promptNames = data.prompts.map((p: { name: string }) => p.name)
    expect(promptNames).toContain('analyze_transaction')
    expect(promptNames).toContain('summarize_agent_activity')
    expect(promptNames).toContain('explain_proposal')
  })

  test('prompts should have proper arguments', async ({ request }) => {
    const response = await request.post(`${MCP_BASE_URL}/prompts/list`, {
      data: {},
    })
    const data = await response.json()

    for (const prompt of data.prompts) {
      expect(prompt.name).toBeDefined()
      expect(prompt.description).toBeDefined()
      expect(prompt.arguments).toBeDefined()
      expect(Array.isArray(prompt.arguments)).toBeTruthy()
    }
  })

  test('POST /prompts/get analyze_transaction should return messages', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/prompts/get`, {
      data: {
        name: 'analyze_transaction',
        arguments: {
          hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.messages).toBeDefined()
    expect(Array.isArray(data.messages)).toBeTruthy()
    expect(data.messages[0].role).toBe('user')
    expect(data.messages[0].content.text).toContain('Analyze')
    expect(data.messages[0].content.text).toContain('0x123')
  })

  test('POST /prompts/get summarize_agent_activity should return messages', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/prompts/get`, {
      data: {
        name: 'summarize_agent_activity',
        arguments: { agentId: 'agent-123', days: 7 },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.messages).toBeDefined()
    expect(data.messages[0].content.text).toContain('Summarize')
    expect(data.messages[0].content.text).toContain('agent-123')
    expect(data.messages[0].content.text).toContain('7')
  })

  test('POST /prompts/get explain_proposal should return messages', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/prompts/get`, {
      data: {
        name: 'explain_proposal',
        arguments: { proposalId: 'proposal-456' },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.messages).toBeDefined()
    expect(data.messages[0].content.text).toContain('Explain')
    expect(data.messages[0].content.text).toContain('proposal-456')
  })

  test('POST /prompts/get with unknown prompt should return 404', async ({
    request,
  }) => {
    const response = await request.post(`${MCP_BASE_URL}/prompts/get`, {
      data: {
        name: 'unknown_prompt',
        arguments: {},
      },
    })

    expect(response.status()).toBe(404)
  })
})

test.describe('MCP Security', () => {
  test('should have rate limit headers', async ({ request }) => {
    const response = await request.post(`${MCP_BASE_URL}/initialize`, {
      data: {},
    })

    const headers = response.headers()
    expect(headers['x-ratelimit-limit']).toBeDefined()
    expect(headers['x-ratelimit-remaining']).toBeDefined()
    expect(headers['x-ratelimit-reset']).toBeDefined()
  })

  test('should reject oversized request body', async ({ request }) => {
    // Create a payload larger than 1MB
    const largePayload = { data: 'x'.repeat(1024 * 1024 + 100) }

    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      data: largePayload,
    })

    expect(response.status()).toBe(413)
  })

  test('should handle invalid JSON gracefully', async ({ request }) => {
    const response = await request.post(`${MCP_BASE_URL}/tools/call`, {
      headers: { 'Content-Type': 'application/json' },
      data: '{invalid json',
    })

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('JSON')
  })
})

test.describe('MCP CORS', () => {
  test('should have CORS headers', async ({ request }) => {
    const response = await request.get(`${MCP_BASE_URL}/`)

    const headers = response.headers()
    expect(headers['access-control-allow-origin']).toBeDefined()
  })
})
