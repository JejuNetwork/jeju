/**
 * A2A server tests for Prometheus metrics interface.
 *
 * These tests REQUIRE the A2A server and Prometheus to be running.
 * They will FAIL if services are unavailable.
 *
 * Run with: jeju test --mode integration --app monitoring
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { A2AResponseSchema, AgentCardSchema } from '../../lib/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const A2A_PORT = 9091
const A2A_URL = `http://localhost:${A2A_PORT}`

let serverProcess: ChildProcess | null = null
let serverStartedByTests = false

async function checkServerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${A2A_URL}/.well-known/agent-card.json`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) return false
    const text = await response.text()
    if (!text || text.trim() === '') return false
    const parsed = AgentCardSchema.safeParse(JSON.parse(text))
    return parsed.success
  } catch {
    return false
  }
}

async function requireA2AServer(): Promise<void> {
  if (await checkServerAvailable()) {
    console.log('A2A server already running')
    return
  }

  const monitoringDir = join(__dirname, '../..')
  const serverPath = join(monitoringDir, 'api', 'a2a.ts')

  if (!existsSync(serverPath)) {
    throw new Error(`FATAL: A2A server file not found at ${serverPath}`)
  }

  console.log('Starting A2A server...')
  serverProcess = spawn('bun', [serverPath], {
    cwd: monitoringDir,
    env: { ...process.env, PROMETHEUS_URL: 'http://localhost:9090' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderrBuffer = ''
  if (serverProcess.stderr) {
    serverProcess.stderr.on('data', (data: Buffer) => {
      stderrBuffer += data.toString()
    })
  }

  for (let retries = 10; retries > 0; retries--) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (await checkServerAvailable()) {
      console.log('A2A server started successfully')
      serverStartedByTests = true
      return
    }
  }

  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill()
    if (stderrBuffer) {
      throw new Error(
        `FATAL: A2A server failed to start: ${stderrBuffer.substring(0, 500)}`,
      )
    }
  }

  throw new Error(
    `FATAL: A2A server failed to start within 5 seconds. ` +
      `Make sure Prometheus is running on http://localhost:9090`,
  )
}

beforeAll(async () => {
  await requireA2AServer()
}, 30000)

afterAll(() => {
  if (serverProcess && serverStartedByTests) {
    console.log('Stopping A2A server...')
    serverProcess.kill()
  }
})

describe('A2A Monitoring Server', () => {
  test('should serve agent card', async () => {
    const response = await fetch(`${A2A_URL}/.well-known/agent-card.json`)
    expect(response.ok).toBe(true)

    const text = await response.text()
    expect(text.length).toBeGreaterThan(0)

    const card = AgentCardSchema.parse(JSON.parse(text))
    expect(card.protocolVersion).toBe('0.3.0')
    expect(card.name).toBe('Jeju Monitoring')
    expect(card.description).toContain('Prometheus')
    expect(card.skills).toBeArray()
    expect(card.skills.length).toBe(6)

    const skillIds = card.skills.map((s) => s.id)
    expect(skillIds).toContain('query-metrics')
    expect(skillIds).toContain('get-alerts')
    expect(skillIds).toContain('get-targets')
    expect(skillIds).toContain('oif-stats')
    expect(skillIds).toContain('oif-solver-health')
    expect(skillIds).toContain('oif-route-stats')
  })

  test('should handle query-metrics skill', async () => {
    const payload = {
      jsonrpc: '2.0',
      method: 'message/send',
      id: '1',
      params: {
        message: {
          messageId: 'test-1',
          parts: [
            { kind: 'data', data: { skillId: 'query-metrics', query: 'up' } },
          ],
        },
      },
    }

    const response = await fetch(`${A2A_URL}/api/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.ok).toBe(true)

    const text = await response.text()
    expect(text.length).toBeGreaterThan(0)

    const result = A2AResponseSchema.parse(JSON.parse(text))
    expect(result.jsonrpc).toBe('2.0')
    expect(result.id).toBe('1')
    expect(result.result).toBeDefined()
    expect(result.result?.role).toBe('agent')
    expect(result.result?.parts).toBeArray()
  })

  test('should handle get-alerts skill', async () => {
    const payload = {
      jsonrpc: '2.0',
      method: 'message/send',
      id: '2',
      params: {
        message: {
          messageId: 'test-2',
          parts: [{ kind: 'data', data: { skillId: 'get-alerts' } }],
        },
      },
    }

    const response = await fetch(`${A2A_URL}/api/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.ok).toBe(true)

    const text = await response.text()
    expect(text.length).toBeGreaterThan(0)

    const result = A2AResponseSchema.parse(JSON.parse(text))
    expect(result.jsonrpc).toBe('2.0')
    expect(result.result).toBeDefined()
  })

  test('should handle get-targets skill', async () => {
    const payload = {
      jsonrpc: '2.0',
      method: 'message/send',
      id: '3',
      params: {
        message: {
          messageId: 'test-3',
          parts: [{ kind: 'data', data: { skillId: 'get-targets' } }],
        },
      },
    }

    const response = await fetch(`${A2A_URL}/api/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.ok).toBe(true)
    const result = A2AResponseSchema.parse(await response.json())
    expect(result.jsonrpc).toBe('2.0')
    expect(result.result).toBeDefined()
  })

  test('should handle missing query parameter', async () => {
    const payload = {
      jsonrpc: '2.0',
      method: 'message/send',
      id: '4',
      params: {
        message: {
          messageId: 'test-4',
          parts: [{ kind: 'data', data: { skillId: 'query-metrics' } }],
        },
      },
    }

    const response = await fetch(`${A2A_URL}/api/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.ok).toBe(true)

    const text = await response.text()
    expect(text.length).toBeGreaterThan(0)

    const result = A2AResponseSchema.parse(JSON.parse(text))
    const textPart = result.result?.parts.find((p) => p.kind === 'text')
    expect(textPart?.text).toBe('Missing PromQL query')
  })

  test('should handle unknown skill', async () => {
    const payload = {
      jsonrpc: '2.0',
      method: 'message/send',
      id: '5',
      params: {
        message: {
          messageId: 'test-5',
          parts: [{ kind: 'data', data: { skillId: 'unknown-skill' } }],
        },
      },
    }

    const response = await fetch(`${A2A_URL}/api/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.ok).toBe(true)

    const text = await response.text()
    expect(text.length).toBeGreaterThan(0)

    const result = A2AResponseSchema.parse(JSON.parse(text))
    const textPart = result.result?.parts.find((p) => p.kind === 'text')
    expect(textPart?.text).toBe('Unknown skill')
  })

  test('should handle unknown method', async () => {
    const payload = {
      jsonrpc: '2.0',
      method: 'unknown/method',
      id: '6',
      params: {},
    }

    const response = await fetch(`${A2A_URL}/api/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(response.ok).toBe(true)

    const text = await response.text()
    expect(text.length).toBeGreaterThan(0)

    const result = A2AResponseSchema.parse(JSON.parse(text))
    expect(result.error).toBeDefined()
    expect(result.error?.code).toBe(-32601)
    expect(result.error?.message).toBe('Method not found')
  })
})

describe('A2A Monitoring Server - Integration', () => {
  test('should provide useful examples in agent card', async () => {
    const response = await fetch(`${A2A_URL}/.well-known/agent-card.json`)
    const text = await response.text()
    expect(text.length).toBeGreaterThan(0)

    const card = AgentCardSchema.parse(JSON.parse(text))

    const queryMetrics = card.skills.find((s) => s.id === 'query-metrics')
    expect(queryMetrics?.examples).toBeArray()
    expect(queryMetrics?.examples.length).toBeGreaterThan(0)
  })

  test('should have correct CORS headers', async () => {
    const response = await fetch(`${A2A_URL}/.well-known/agent-card.json`)
    const corsHeader = response.headers.get('access-control-allow-origin')
    expect(corsHeader).toBeDefined()
  })

  test('should handle concurrent requests', async () => {
    const requests = Array.from({ length: 5 }, (_, i) => ({
      jsonrpc: '2.0',
      method: 'message/send',
      id: `concurrent-${i}`,
      params: {
        message: {
          messageId: `test-concurrent-${i}`,
          parts: [{ kind: 'data', data: { skillId: 'get-alerts' } }],
        },
      },
    }))

    const responses = await Promise.all(
      requests.map((payload) =>
        fetch(`${A2A_URL}/api/a2a`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      ),
    )

    expect(responses.every((r) => r.ok)).toBe(true)

    const results = await Promise.all(
      responses.map(async (r) => {
        const text = await r.text()
        expect(text.length).toBeGreaterThan(0)
        return A2AResponseSchema.parse(JSON.parse(text))
      }),
    )
    expect(results.every((r) => r.jsonrpc === '2.0')).toBe(true)
  })
})
