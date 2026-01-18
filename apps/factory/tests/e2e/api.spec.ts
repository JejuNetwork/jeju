/**
 * API Endpoints E2E Tests
 * Tests REST, MCP, and A2A protocol endpoints
 */

import { getTestConfig } from '@jejunetwork/config/test-config'
import { expect, test, type APIRequestContext } from '@playwright/test'

const config = getTestConfig('factory')

function normalizeBaseURL(baseURL: string): string {
  if (baseURL.endsWith('/')) {
    return baseURL
  }
  return `${baseURL}/`
}

const apiBaseURL = normalizeBaseURL(
  process.env.FACTORY_API_URL || config.apiURL,
)
let apiRequest: APIRequestContext

function normalizeApiPath(path: string): string {
  if (path.startsWith('/')) {
    return path.slice(1)
  }
  return path
}

test.beforeAll(async ({ playwright }) => {
  apiRequest = await playwright.request.newContext({ baseURL: apiBaseURL })
  console.log(`[Factory API] baseURL=${apiBaseURL}`)
  await warmApi()
})

test.afterAll(async () => {
  await apiRequest.dispose()
})

async function apiGet(path: string): Promise<Response> {
  const normalizedPath = normalizeApiPath(path)
  let lastResponse: Response | null = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await apiRequest.get(normalizedPath)
    if (response.ok() || response.status() < 500) {
      return response
    }
    lastResponse = response
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
  }
  return lastResponse ?? apiRequest.get(normalizedPath)
}

async function apiPost(
  path: string,
  options?: Parameters<APIRequestContext['post']>[1],
): Promise<Response> {
  const normalizedPath = normalizeApiPath(path)
  let lastResponse: Response | null = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await apiRequest.post(normalizedPath, options)
    if (response.ok() || response.status() < 500) {
      return response
    }
    lastResponse = response
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
  }
  return lastResponse ?? apiRequest.post(normalizedPath, options)
}

async function warmApi(): Promise<void> {
  let lastResponse: Response | null = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await apiRequest.get(normalizeApiPath('/api/health'))
    if (response.ok()) {
      return
    }
    lastResponse = response
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)))
  }
  if (!lastResponse) {
    throw new Error('Factory API warmup failed: no response')
  }
  const body = await lastResponse.text()
  throw new Error(
    `Factory API warmup failed: ${lastResponse.status()} ${body}`,
  )
}

test.describe('REST API', () => {
  test.describe('Health', () => {
    test('returns health status', async ({ request }) => {
      const response = await apiGet('/api/health')
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.status).toBeDefined()
      expect(['healthy', 'degraded', 'unhealthy']).toContain(data.status)
    })
  })

  test.describe('Bounties', () => {
    test('lists bounties', async ({ request }) => {
      const response = await apiGet('/api/bounties')
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.bounties).toBeDefined()
      expect(Array.isArray(data.bounties)).toBeTruthy()
    })

    test('filters bounties by status', async ({ request }) => {
      const response = await apiGet('/api/bounties?status=open')
      expect(response.ok()).toBeTruthy()
    })
  })

  test.describe('Jobs', () => {
    test('lists jobs', async ({ request }) => {
      const response = await apiGet('/api/jobs')
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.jobs).toBeDefined()
    })
  })

  test.describe('Git', () => {
    test('lists repositories', async ({ request }) => {
      const response = await apiGet('/api/git')
      expect(response.ok()).toBeTruthy()
    })
  })

  test.describe('Packages', () => {
    test('lists packages', async ({ request }) => {
      const response = await apiGet('/api/packages')
      expect(response.ok()).toBeTruthy()
    })
  })

  test.describe('Models', () => {
    test('lists models', async ({ request }) => {
      const response = await apiGet('/api/models')
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.models).toBeDefined()
    })
  })

  test.describe('Containers', () => {
    test('lists containers', async ({ request }) => {
      const response = await apiGet('/api/containers')
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.containers).toBeDefined()
    })
  })

  test.describe('Projects', () => {
    test('lists projects', async ({ request }) => {
      const response = await apiGet('/api/projects')
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.projects).toBeDefined()
    })
  })

  test.describe('Issues', () => {
    test('lists issues', async ({ request }) => {
      const response = await apiGet('/api/issues')
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.issues).toBeDefined()
    })
  })

  test.describe('Pull Requests', () => {
    test('lists pull requests', async ({ request }) => {
      const response = await apiGet('/api/pulls')
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.pulls).toBeDefined()
    })
  })

  test.describe('Datasets', () => {
    test('lists datasets', async ({ request }) => {
      const response = await apiGet('/api/datasets')
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.datasets).toBeDefined()
    })
  })

  test.describe('CI/CD', () => {
    test('lists CI runs', async ({ request }) => {
      const response = await apiGet('/api/ci')
      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.runs).toBeDefined()
    })
  })
})

test.describe('MCP API', () => {
  test('returns MCP server info', async ({ request }) => {
    const response = await apiGet('/api/mcp/info')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.server).toBe('jeju-factory')
    expect(data.resources).toBeDefined()
    expect(data.tools).toBeDefined()
  })

  test('initializes MCP session', async ({ request }) => {
    const response = await apiPost('/api/mcp/initialize')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.protocolVersion).toBeDefined()
    expect(data.serverInfo).toBeDefined()
    expect(data.capabilities).toBeDefined()
  })

  test('lists MCP resources', async ({ request }) => {
    const response = await apiPost('/api/mcp/resources/list')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.resources).toBeDefined()
    expect(Array.isArray(data.resources)).toBeTruthy()
    expect(data.resources.length).toBeGreaterThan(0)
  })

  test('reads MCP resource', async ({ request }) => {
    const response = await apiPost('/api/mcp/resources/read', {
      data: { uri: 'factory://bounties' },
    })
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contents).toBeDefined()
  })

  test('lists MCP tools', async ({ request }) => {
    const response = await apiPost('/api/mcp/tools/list')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.tools).toBeDefined()
    expect(Array.isArray(data.tools)).toBeTruthy()
    expect(data.tools.length).toBeGreaterThan(0)
  })

  test('calls MCP tool', async ({ request }) => {
    const response = await apiPost('/api/mcp/tools/call', {
      data: {
        name: 'list_bounties',
        arguments: { status: 'open' },
      },
    })
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.content).toBeDefined()
  })

  test('lists MCP prompts', async ({ request }) => {
    const response = await apiPost('/api/mcp/prompts/list')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.prompts).toBeDefined()
  })
})

test.describe('A2A API', () => {
  test('returns agent card', async ({ request }) => {
    const response = await apiGet('/api/a2a')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.name).toBe('Jeju Factory')
    expect(data.skills).toBeDefined()
    expect(Array.isArray(data.skills)).toBeTruthy()
  })

  test('serves agent card from public', async ({ request }) => {
    const response = await apiGet('/agent-card.json')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.protocolVersion).toBe('0.3.0')
    expect(data.skills).toBeDefined()
  })

  test('handles A2A message/send', async ({ request }) => {
    const response = await apiPost('/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-123',
            parts: [{ kind: 'data', data: { skillId: 'list-repos' } }],
          },
        },
        id: 1,
      },
    })
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.jsonrpc).toBe('2.0')
    expect(data.result).toBeDefined()
    expect(data.result.parts).toBeDefined()
  })

  test('executes list-bounties skill', async ({ request }) => {
    const response = await apiPost('/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-456',
            parts: [{ kind: 'data', data: { skillId: 'list-bounties' } }],
          },
        },
        id: 2,
      },
    })
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.result.parts).toBeDefined()
    const parts = Array.isArray(data.result.parts) ? data.result.parts : []
    const dataPart = parts.find(
      (part): part is { kind: string; data?: { bounties?: unknown } } =>
        typeof part === 'object' &&
        part !== null &&
        'kind' in part &&
        (part as { kind: string }).kind === 'data',
    )
    expect(dataPart?.data?.bounties).toBeDefined()
  })

  test('executes search-packages skill', async ({ request }) => {
    const response = await apiPost('/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-789',
            parts: [
              {
                kind: 'data',
                data: { skillId: 'search-packages', query: 'sdk' },
              },
            ],
          },
        },
        id: 3,
      },
    })
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.result).toBeDefined()
  })

  test('handles unknown method', async ({ request }) => {
    const response = await apiPost('/api/a2a', {
      data: {
        jsonrpc: '2.0',
        method: 'unknown/method',
        id: 99,
      },
    })
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.error).toBeDefined()
    expect(data.error.code).toBe(-32601)
  })
})
