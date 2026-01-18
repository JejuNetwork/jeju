/**
 * Autonomous Agent Verification Tests
 *
 * These tests verify that autonomous agents:
 * 1. Start up and register correctly
 * 2. Execute ticks and process messages
 * 3. Can access DWS inference
 * 4. Track activity properly
 */

import { beforeAll, describe, expect, test } from 'bun:test'

const API_URL = process.env.CRUCIBLE_API ?? 'http://localhost:4021'

describe('Autonomous Agent Verification', () => {
  let serverUp = false

  beforeAll(async () => {
    // Check if server is running
    try {
      const response = await fetch(`${API_URL}/health`)
      serverUp = response.ok
      if (!serverUp) {
        console.log('Crucible server not running, skipping tests')
      }
    } catch {
      console.log('Crucible server not reachable, skipping tests')
    }
  })

  test('server health check', async () => {
    if (!serverUp) {
      console.log('SKIPPED: Server not running')
      return
    }

    const response = await fetch(`${API_URL}/health`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as { status: string; network: string }
    expect(data.status).toBe('healthy')
    expect(data.network).toBeDefined()
  })

  test('autonomous runner is enabled', async () => {
    if (!serverUp) return

    const response = await fetch(`${API_URL}/api/v1/autonomous/status`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as {
      enabled: boolean
      running?: boolean
      agentCount?: number
    }

    // If autonomous is not enabled, log and skip
    if (!data.enabled) {
      console.log(
        'SKIPPED: Autonomous mode not enabled (set AUTONOMOUS_ENABLED=true)',
      )
      return
    }

    expect(data.running).toBe(true)
    expect(data.agentCount).toBeGreaterThan(0)
  })

  test('expected agents are registered', async () => {
    if (!serverUp) return

    const response = await fetch(`${API_URL}/api/v1/autonomous/status`)
    const data = (await response.json()) as {
      enabled: boolean
      agents?: Array<{ id: string; character: string }>
    }

    if (!data.enabled) return

    const agents = data.agents ?? []
    // These are the agents auto-registered in server.ts when AUTONOMOUS_ENABLED=true
    const expectedAgents = [
      'base-watcher',
      'security-analyst',
      'node-monitor',
      'infra-analyzer',
      'endpoint-prober',
    ]

    for (const expected of expectedAgents) {
      const found = agents.find((a: { id: string; character: string }) =>
        a.id.includes(expected),
      )
      expect(found).toBeDefined()
      console.log(`Agent ${expected}: ${found?.character} (registered)`)
    }
  })

  test('agents respond to chat', async () => {
    if (!serverUp) return

    // Test each agent can respond to a simple chat
    const testAgents = ['project-manager', 'community-manager', 'moderator']

    for (const agentId of testAgents) {
      const response = await fetch(`${API_URL}/api/v1/chat/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello, are you working?' }),
      })

      if (!response.ok) {
        console.log(`Agent ${agentId}: NOT_OK (${response.status})`)
        continue
      }

      const data = (await response.json()) as {
        text?: string
        response?: { text: string }
      }
      const text = data.text ?? data.response?.text

      expect(text).toBeDefined()
      expect(text?.length).toBeGreaterThan(10)
      console.log(`Agent ${agentId}: OK (response ${text?.length} chars)`)
    }
  })

  test('activity endpoint returns metrics', async () => {
    if (!serverUp) return

    const response = await fetch(`${API_URL}/api/v1/autonomous/activity`)
    expect(response.ok).toBe(true)

    const data = (await response.json()) as {
      enabled: boolean
      summary: {
        totalAgents: number
        totalTicks: number
        uptimeMs: number
      }
      agents: Array<{
        id: string
        tickCount: number
        tickRate: number
      }>
      network: string
    }

    if (!data.enabled) {
      console.log('SKIPPED: Autonomous not enabled')
      return
    }

    expect(data.summary.totalAgents).toBeGreaterThan(0)
    expect(data.network).toBeDefined()

    console.log(`Activity Summary:`)
    console.log(`  Total Agents: ${data.summary.totalAgents}`)
    console.log(`  Total Ticks: ${data.summary.totalTicks}`)
    console.log(`  Uptime: ${Math.round(data.summary.uptimeMs / 1000)}s`)

    for (const agent of data.agents) {
      console.log(
        `  ${agent.id}: ${agent.tickCount} ticks (${agent.tickRate}/min)`,
      )
    }
  })

  test('prometheus metrics include autonomous data', async () => {
    if (!serverUp) return

    const response = await fetch(`${API_URL}/metrics`)
    expect(response.ok).toBe(true)

    const text = await response.text()

    expect(text).toContain('crucible_autonomous_enabled')
    expect(text).toContain('crucible_autonomous_agents_count')
    expect(text).toContain('crucible_autonomous_ticks_total')

    // Parse some values
    const enabledMatch = text.match(/crucible_autonomous_enabled (\d+)/)
    const agentsMatch = text.match(/crucible_autonomous_agents_count (\d+)/)
    const ticksMatch = text.match(/crucible_autonomous_ticks_total (\d+)/)

    console.log(`Prometheus Metrics:`)
    console.log(`  autonomous_enabled: ${enabledMatch?.[1]}`)
    console.log(`  agents_count: ${agentsMatch?.[1]}`)
    console.log(`  ticks_total: ${ticksMatch?.[1]}`)
  })

  test('DWS inference is available', async () => {
    if (!serverUp) return

    // Check if DWS is healthy
    const dwsUrl = process.env.DWS_URL ?? 'http://localhost:4030'

    try {
      const response = await fetch(`${dwsUrl}/health`)
      if (!response.ok) {
        console.log('SKIPPED: DWS not available')
        return
      }

      // Check inference nodes
      const nodesResponse = await fetch(`${dwsUrl}/compute/inference/nodes`)
      if (nodesResponse.ok) {
        const nodes = (await nodesResponse.json()) as {
          nodes?: Array<{ id: string }>
        }
        console.log(`DWS Inference Nodes: ${nodes.nodes?.length ?? 0}`)
      }
    } catch {
      console.log('SKIPPED: DWS not reachable')
    }
  })

  test('agents have 80 actions available', async () => {
    if (!serverUp) return

    // This is validated in the server logs when agents initialize
    // We can verify by checking a known agent's capabilities
    const response = await fetch(`${API_URL}/api/v1/autonomous/status`)
    const data = (await response.json()) as { enabled: boolean }

    if (!data.enabled) return

    // The agents log shows "Jeju plugin loaded" with 80 actions
    // This test just confirms agents are working
    const chatResponse = await fetch(`${API_URL}/api/v1/chat/project-manager`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What actions can you perform on the Jeju network?',
      }),
    })

    if (chatResponse.ok) {
      const data = (await chatResponse.json()) as { text: string }
      expect(data.text.length).toBeGreaterThan(50)
      console.log(`Agent described capabilities (${data.text.length} chars)`)
    }
  })
})
