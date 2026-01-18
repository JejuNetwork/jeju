/**
 * MCP Tests - Model Context Protocol tools and resources
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'

const AUTOCRAT_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_API.get()}`

interface MCPTool {
  name: string
  description: string
  inputSchema: { type: string }
}

interface _MCPResource {
  uri: string
}

test.describe('MCP Tools', () => {
  test('list tools returns governance tools', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/mcp/tools/list`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.tools).toBeDefined()
    expect(data.tools.length).toBeGreaterThan(0)

    const toolNames = data.tools.map((t: MCPTool) => t.name)
    expect(toolNames).toContain('assess_proposal_quality')
    expect(toolNames).toContain('prepare_proposal_submission')
  })

  test('tools have proper schema definitions', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/mcp/tools/list`)
    const data = await response.json()

    for (const tool of data.tools as MCPTool[]) {
      expect(tool.name).toBeDefined()
      expect(tool.description).toBeDefined()
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  test('assess_proposal_quality tool works', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/mcp/tools/call`, {
      data: {
        name: 'assess_proposal_quality',
        arguments: {
          title: 'Improve DAO Treasury Management',
          summary:
            'This proposal implements better treasury management for long-term sustainability.',
          description: `
## Problem
Current treasury management is manual and lacks transparency.

## Solution
Implement automated treasury management with community oversight.

## Implementation
Deploy treasury contracts with multi-sig governance.

## Timeline
2 weeks for development, 1 week for testing.

## Cost
15 ETH total budget.

## Benefit
Better risk management and member trust.

## Risk Assessment
Smart contract risks mitigated by audits.
          `,
          proposalType: 'TREASURY_ALLOCATION',
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.content).toBeDefined()
    expect(data.isError).toBe(false)

    const result = JSON.parse(data.content[0].text)
    expect(result.overallScore).toBeDefined()
    expect(result.criteria).toBeDefined()
  })

  test('prepare_proposal_submission tool works', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/mcp/tools/call`, {
      data: {
        name: 'prepare_proposal_submission',
        arguments: {
          proposalType: 'GRANT',
          qualityScore: '92',
          contentHash: `0x${'a'.repeat(64)}`,
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.isError).toBe(false)

    const result = JSON.parse(data.content[0].text)
    expect(result.transaction).toBeDefined()
    expect(result.transaction.method).toBe('submitProposal')
  })

  test('request_deep_research tool returns research info', async ({
    request,
  }) => {
    const response = await request.post(`${AUTOCRAT_URL}/mcp/tools/call`, {
      data: {
        name: 'request_deep_research',
        arguments: {
          proposalId: `0x${'b'.repeat(64)}`,
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.isError).toBe(false)

    const result = JSON.parse(data.content[0].text)
    expect(result.proposalId).toBeDefined()
    expect(result.service).toBe('deep-research')
  })
})

test.describe('MCP Resources', () => {
  test('list resources returns governance resources', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/mcp/resources/list`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.resources).toBeDefined()
    expect(data.resources.length).toBeGreaterThan(0)
  })

  test('board agents resource returns roles', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/mcp/resources/read`, {
      data: { uri: 'autocrat://board/agents' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.contents).toBeDefined()
    expect(data.contents.length).toBe(1)

    const content = JSON.parse(data.contents[0].text)
    expect(content.agents).toBeDefined()
    expect(content.agents.length).toBe(4)

    const roles = content.agents.map((a: { role: string }) => a.role)
    expect(roles).toContain('Treasury')
    expect(roles).toContain('Code')
    expect(roles).toContain('Community')
    expect(roles).toContain('Security')
  })

  test('invalid resource returns 404', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/mcp/resources/read`, {
      data: { uri: 'autocrat://invalid/resource' },
    })

    expect(response.status()).toBe(404)
  })
})

test.describe('MCP Protocol', () => {
  test('initialize returns capabilities', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/mcp/initialize`, {
      data: {
        protocolVersion: '2024-11-05',
        capabilities: {},
      },
    })
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.protocolVersion).toBe('2024-11-05')
    expect(data.serverInfo).toBeDefined()
    expect(data.serverInfo.name).toBe('jeju-board')
    expect(data.capabilities.resources).toBe(true)
    expect(data.capabilities.tools).toBe(true)
  })

  test('discovery endpoint works', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/mcp`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.server).toBe('jeju-board')
    expect(data.resources).toBeDefined()
    expect(data.tools).toBeDefined()
  })
})
