/**
 * Jeju Indexer - A2A API E2E Tests
 * 
 * Tests for the Agent-to-Agent API endpoints:
 * - Agent card endpoint
 * - A2A message handling
 * - Static file serving
 */

import { test, expect } from '@playwright/test'

const A2A_BASE_URL = process.env.A2A_URL || 'http://localhost:4351'

test.describe('A2A Agent Card', () => {
  test('should return agent card at well-known endpoint', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/.well-known/agent-card.json`)
    
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('application/json')
    
    const agentCard = await response.json()
    expect(agentCard.name).toBe('Jeju Indexer')
    expect(agentCard.protocolVersion).toBe('0.3.0')
  })

  test('should have correct agent card structure', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/.well-known/agent-card.json`)
    const agentCard = await response.json()
    
    // Required fields
    expect(agentCard).toHaveProperty('protocolVersion')
    expect(agentCard).toHaveProperty('name')
    expect(agentCard).toHaveProperty('description')
    expect(agentCard).toHaveProperty('url')
    expect(agentCard).toHaveProperty('provider')
    expect(agentCard).toHaveProperty('version')
    expect(agentCard).toHaveProperty('capabilities')
    expect(agentCard).toHaveProperty('skills')
  })

  test('should list available skills', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/.well-known/agent-card.json`)
    const agentCard = await response.json()
    
    expect(Array.isArray(agentCard.skills)).toBeTruthy()
    expect(agentCard.skills.length).toBeGreaterThan(0)
    
    // Check skill structure
    const skill = agentCard.skills[0]
    expect(skill).toHaveProperty('id')
    expect(skill).toHaveProperty('name')
    expect(skill).toHaveProperty('description')
  })

  test('should have query-blocks skill', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/.well-known/agent-card.json`)
    const agentCard = await response.json()
    
    const blockSkill = agentCard.skills.find((s: { id: string }) => s.id === 'query-blocks')
    expect(blockSkill).toBeDefined()
    expect(blockSkill.name).toBe('Query Blocks')
  })

  test('should have query-transactions skill', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/.well-known/agent-card.json`)
    const agentCard = await response.json()
    
    const txSkill = agentCard.skills.find((s: { id: string }) => s.id === 'query-transactions')
    expect(txSkill).toBeDefined()
    expect(txSkill.name).toBe('Query Transactions')
  })

  test('should have query-tokens skill', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/.well-known/agent-card.json`)
    const agentCard = await response.json()
    
    const tokenSkill = agentCard.skills.find((s: { id: string }) => s.id === 'query-tokens')
    expect(tokenSkill).toBeDefined()
    expect(tokenSkill.name).toBe('Query Tokens')
  })

  test('should have custom-query skill (premium)', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/.well-known/agent-card.json`)
    const agentCard = await response.json()
    
    const customSkill = agentCard.skills.find((s: { id: string }) => s.id === 'custom-query')
    expect(customSkill).toBeDefined()
    expect(customSkill.tags).toContain('premium')
  })
})

test.describe('A2A Message API', () => {
  test('should reject non-POST requests', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/api/a2a`)
    // Express doesn't have GET handler, should return 404
    expect(response.status()).toBe(404)
  })

  test('should reject unknown methods', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'unknown/method',
        id: 1
      }
    })
    
    expect(response.ok()).toBeTruthy()
    const result = await response.json()
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe(-32601)
  })

  test('should handle message/send with query-blocks skill', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-1',
            parts: [
              { kind: 'data', data: { skillId: 'query-blocks' } }
            ]
          }
        },
        id: 1
      }
    })
    
    expect(response.ok()).toBeTruthy()
    const result = await response.json()
    expect(result.result).toBeDefined()
    expect(result.result.role).toBe('agent')
    expect(result.result.parts).toBeDefined()
  })

  test('should handle message/send with query-transactions skill', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-2',
            parts: [
              { kind: 'data', data: { skillId: 'query-transactions' } }
            ]
          }
        },
        id: 2
      }
    })
    
    expect(response.ok()).toBeTruthy()
    const result = await response.json()
    expect(result.result).toBeDefined()
  })

  test('should handle message/send with query-tokens skill', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-3',
            parts: [
              { kind: 'data', data: { skillId: 'query-tokens' } }
            ]
          }
        },
        id: 3
      }
    })
    
    expect(response.ok()).toBeTruthy()
    const result = await response.json()
    expect(result.result).toBeDefined()
  })

  test('should handle custom-query skill (premium)', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-4',
            parts: [
              { kind: 'data', data: { skillId: 'custom-query' } }
            ]
          }
        },
        id: 4
      }
    })
    
    expect(response.ok()).toBeTruthy()
    const result = await response.json()
    expect(result.result).toBeDefined()
    // Should indicate payment required
    const dataPart = result.result.parts.find((p: { kind: string }) => p.kind === 'data')
    expect(dataPart.data.note).toContain('Payment required')
  })

  test('should reject unknown skills', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-5',
            parts: [
              { kind: 'data', data: { skillId: 'unknown-skill' } }
            ]
          }
        },
        id: 5
      }
    })
    
    expect(response.ok()).toBeTruthy()
    const result = await response.json()
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe(-32602)
  })

  test('should reject missing message params', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {},
        id: 6
      }
    })
    
    expect(response.ok()).toBeTruthy()
    const result = await response.json()
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe(-32602)
  })

  test('should reject missing data part', async ({ request }) => {
    const response = await request.post(`${A2A_BASE_URL}/api/a2a`, {
      data: {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-7',
            parts: [
              { kind: 'text', text: 'Hello' }
            ]
          }
        },
        id: 7
      }
    })
    
    expect(response.ok()).toBeTruthy()
    const result = await response.json()
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe(-32602)
  })
})

test.describe('Static File Serving', () => {
  test('should serve playground.html at /playground', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/playground`)
    
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['content-type']).toContain('text/html')
    
    const html = await response.text()
    expect(html).toContain('Jeju Indexer')
    expect(html).toContain('GraphQL Explorer')
  })

  test('root should redirect to playground', async ({ page }) => {
    await page.goto(A2A_BASE_URL)
    
    // Should redirect to /playground
    await expect(page).toHaveURL(`${A2A_BASE_URL}/playground`)
  })
})

test.describe('CORS', () => {
  test('should have CORS headers enabled', async ({ request }) => {
    const response = await request.get(`${A2A_BASE_URL}/.well-known/agent-card.json`)
    
    // CORS headers should be present
    const headers = response.headers()
    expect(headers['access-control-allow-origin']).toBeDefined()
  })
})

