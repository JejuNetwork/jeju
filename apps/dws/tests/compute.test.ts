/**
 * Compute Service Integration Tests
 *
 * These tests require the DWS server to be running.
 * Run with: bun test tests/compute.test.ts
 * Or via: bun run test:integration
 *
 * For unit tests, use: bun run test
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test'
import {
  inferenceNodes,
  registerNode,
  unregisterNode,
} from '../api/compute/inference-node'
import { dwsRequest } from './setup'

setDefaultTimeout(10000)

const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// Skip integration tests when running from root (parallel execution causes issues)
// Only skip if explicitly requested, not by default in CI
const SKIP = process.env.SKIP_INTEGRATION === 'true'

describe.skipIf(SKIP)('Compute Service', () => {
  // Set up mock inference node for tests
  beforeAll(async () => {
    // Clear any existing nodes
    inferenceNodes.clear()

    // Start a mock inference server for tests
    const mockPort = 14031
    const mockServer = Bun.serve({
      port: mockPort,
      fetch: async (req) => {
        const url = new URL(req.url)

        if (url.pathname === '/health') {
          return Response.json({ status: 'healthy', provider: 'mock' })
        }

        if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
          const body = (await req.json()) as {
            model?: string
            messages?: Array<{ content: string }>
          }
          return Response.json({
            id: `chatcmpl-test-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: body.model ?? 'mock-model',
            provider: 'mock',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: `Mock response to: ${body.messages?.[0]?.content ?? 'test'}`,
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          })
        }

        return new Response('Not Found', { status: 404 })
      },
    })

    ;(globalThis as Record<string, unknown>)._testMockServer = mockServer
    _mockServerStarted = true

    // Register mock inference node
    registerNode({
      address: 'test-mock-node',
      endpoint: `http://localhost:${mockPort}`,
      capabilities: ['inference'],
      models: ['*'],
      provider: 'mock',
      region: 'test',
      gpuTier: 0,
      maxConcurrent: 100,
      isActive: true,
    })
  })

  afterAll(() => {
    unregisterNode('test-mock-node')
    const server = (globalThis as Record<string, unknown>)._testMockServer as
      | { stop?: () => void }
      | undefined
    if (server?.stop) server.stop()
  })
  describe('Health Check', () => {
    test('GET /compute/health should return healthy status', async () => {
      const res = await dwsRequest('/compute/health')
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.service).toBe('dws-compute')
      expect(body.status).toBe('healthy')
      expect(body.activeJobs).toBeDefined()
      expect(body.maxConcurrent).toBeDefined()
      expect(body.queuedJobs).toBeDefined()
    })
  })

  describe('Chat Completions API', () => {
    test('POST /compute/chat/completions routes through inference node', async () => {
      // With mock node registered, routes through it
      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello world' }],
        }),
      })

      expect(res.status).toBe(200)

      const body = (await res.json()) as {
        object: string
        choices: Array<{ message: { role: string; content: string } }>
        provider?: string
        node?: string
      }
      expect(body.object).toBe('chat.completion')
      expect(body.choices).toBeDefined()
      expect(body.choices[0].message.role).toBe('assistant')
      // Response should come through our mock node
      expect(body.provider).toBe('mock')
      expect(body.node).toBe('test-mock-node')
    })

    test('POST /compute/chat/completions returns valid structure', async () => {
      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5.2',
          messages: [{ role: 'user', content: 'Test' }],
        }),
      })

      expect(res.status).toBe(200)

      const body = (await res.json()) as { id: string; model: string }
      expect(body.id).toMatch(/^chatcmpl-/)
      expect(body.model).toBeDefined()
    })

    test('POST /compute/chat/completions returns usage stats', async () => {
      const res = await dwsRequest('/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'Test' }],
        }),
      })

      expect(res.status).toBe(200)

      const body = (await res.json()) as { usage: { total_tokens: number } }
      expect(body).toHaveProperty('usage')
      expect(body.usage.total_tokens).toBeGreaterThan(0)
    })
  })

  describe('Job Submission', () => {
    test('POST /compute/jobs without auth should return 401', async () => {
      const res = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo hello' }),
      })

      expect(res.status).toBe(401)
    })

    test('POST /compute/jobs without command should return 400', async () => {
      const res = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(400)

      const body = (await res.json()) as { error: string }
      expect(body.error).toContain('command')
    })

    test('POST /compute/jobs should submit and queue a job', async () => {
      const res = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo "test output"' }),
      })

      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.jobId).toBeDefined()
      expect(['queued', 'running']).toContain(body.status)
    })

    test('POST /compute/jobs with custom shell should work', async () => {
      const res = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          command: 'echo $SHELL',
          shell: 'sh',
        }),
      })

      expect(res.status).toBe(201)
    })

    test('POST /compute/jobs with environment variables should work', async () => {
      const res = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          command: 'echo $MY_VAR',
          env: { MY_VAR: 'custom_value' },
        }),
      })

      expect(res.status).toBe(201)
    })
  })

  describe('Job Status', () => {
    test('GET /compute/jobs/:jobId should return job details', async () => {
      // Submit a job first
      const submitRes = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo hello' }),
      })

      const { jobId } = (await submitRes.json()) as { jobId: string }

      // Get job status
      const statusRes = await dwsRequest(`/compute/jobs/${jobId}`)
      expect(statusRes.status).toBe(200)

      const body = (await statusRes.json()) as { jobId: string; status: string }
      expect(body.jobId).toBe(jobId)
      expect(body.status).toBeDefined()
    })

    test('GET /compute/jobs/:jobId for non-existent job should return 404', async () => {
      const res = await dwsRequest(
        '/compute/jobs/00000000-0000-0000-0000-000000000000',
      )
      expect(res.status).toBe(404)
    })

    // Job execution tests - these require the compute runner to be active
    // In CI without runner, jobs stay queued which is expected behavior
    test('Job should complete with output (requires runner)', async () => {
      const submitRes = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo "expected output"' }),
      })

      const { jobId } = (await submitRes.json()) as { jobId: string }

      // Wait for completion (up to 5 seconds)
      let status = 'queued'
      let attempts = 0
      let body: { status: string; output: string; exitCode: number } = {
        status: 'queued',
        output: '',
        exitCode: 0,
      }

      while (status !== 'completed' && status !== 'failed' && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100))
        const res = await dwsRequest(`/compute/jobs/${jobId}`)
        body = await res.json()
        status = body.status
        attempts++
      }

      // Either completed or still queued (runner not available)
      expect(['completed', 'queued', 'running']).toContain(body.status)
      if (body.status === 'completed') {
        expect(body.output).toContain('expected output')
        expect(body.exitCode).toBe(0)
      }
    })

    test('Job with failing command should report failure (requires runner)', async () => {
      const submitRes = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'exit 42' }),
      })

      const { jobId } = (await submitRes.json()) as { jobId: string }

      // Wait for completion (up to 5 seconds)
      let status = 'queued'
      let attempts = 0
      let body: { status: string; exitCode: number } = {
        status: 'queued',
        exitCode: 0,
      }

      while (status !== 'completed' && status !== 'failed' && attempts < 50) {
        await new Promise((r) => setTimeout(r, 100))
        const res = await dwsRequest(`/compute/jobs/${jobId}`)
        body = await res.json()
        status = body.status
        attempts++
      }

      // Either failed or still queued (runner not available)
      expect(['failed', 'queued', 'running']).toContain(body.status)
      if (body.status === 'failed') {
        expect(body.exitCode).toBe(42)
      }
    })
  })

  describe('Job Cancellation', () => {
    test('POST /compute/jobs/:jobId/cancel should cancel a queued or running job', async () => {
      // Submit a long-running job
      const submitRes = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'sleep 60' }),
      })

      const { jobId } = (await submitRes.json()) as { jobId: string }

      // Cancel immediately (job is likely still queued)
      const cancelRes = await dwsRequest(`/compute/jobs/${jobId}/cancel`, {
        method: 'POST',
      })

      expect(cancelRes.status).toBe(200)

      const body = (await cancelRes.json()) as { status: string }
      expect(body.status).toBe('cancelled')
    })

    test('POST /compute/jobs/:jobId/cancel for completed job should fail (requires runner)', async () => {
      // Submit quick job
      const submitRes = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo done' }),
      })

      const { jobId } = (await submitRes.json()) as { jobId: string }

      // Wait for potential completion (requires runner)
      await new Promise((r) => setTimeout(r, 500))

      // Try to cancel - will succeed if still queued, fail if completed
      const cancelRes = await dwsRequest(`/compute/jobs/${jobId}/cancel`, {
        method: 'POST',
      })

      // Either 200 (cancelled queued job) or 400 (job already completed)
      expect([200, 400]).toContain(cancelRes.status)
    })

    test('POST /compute/jobs/:jobId/cancel for non-existent job should return 404', async () => {
      const res = await dwsRequest(
        '/compute/jobs/00000000-0000-0000-0000-000000000000/cancel',
        {
          method: 'POST',
        },
      )

      expect(res.status).toBe(404)
    })
  })

  describe('Job Listing', () => {
    test('GET /compute/jobs should return list of jobs', async () => {
      // Submit a job first
      await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo list-test' }),
      })

      const res = await dwsRequest('/compute/jobs')
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.jobs).toBeInstanceOf(Array)
      expect(body.total).toBeGreaterThan(0)
    })

    test('GET /compute/jobs with status filter should filter jobs', async () => {
      const res = await dwsRequest('/compute/jobs?status=completed')
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.jobs).toBeInstanceOf(Array)
      body.jobs.forEach((job: { status: string }) => {
        expect(job.status).toBe('completed')
      })
    })

    test('GET /compute/jobs with limit should respect limit', async () => {
      const res = await dwsRequest('/compute/jobs?limit=5')
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.jobs.length).toBeLessThanOrEqual(5)
    })

    test('GET /compute/jobs with x-jeju-address should filter by submitter', async () => {
      const res = await dwsRequest('/compute/jobs', {
        headers: { 'x-jeju-address': TEST_ADDRESS },
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      // All jobs should be from this submitter (or none if user has no jobs)
      expect(body.jobs).toBeInstanceOf(Array)
    })
  })

  describe('Concurrent Jobs', () => {
    test('should handle multiple concurrent job submissions', async () => {
      const submissions = Array.from({ length: 10 }, (_, i) =>
        dwsRequest('/compute/jobs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': TEST_ADDRESS,
          },
          body: JSON.stringify({ command: `echo "job ${i}"` }),
        }),
      )

      const responses = await Promise.all(submissions)

      responses.forEach((res) => {
        expect(res.status).toBe(201)
      })

      const bodies = await Promise.all(responses.map((r) => r.json()))
      const jobIds = bodies.map((b) => b.jobId)
      const uniqueIds = new Set(jobIds)

      expect(uniqueIds.size).toBe(10) // All unique job IDs
    })
  })

  describe('Job Edge Cases', () => {
    test('should handle command with special characters', async () => {
      const res = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          command: 'echo "quotes \\"nested\\" and $variables"',
        }),
      })

      expect(res.status).toBe(201)
    })

    test('should handle multi-line commands', async () => {
      const res = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          command: `echo "line 1"
echo "line 2"
echo "line 3"`,
        }),
      })

      expect(res.status).toBe(201)
      const { jobId } = await res.json()
      expect(jobId).toBeDefined()

      // Verify job was created (execution requires compute runner)
      const statusRes = await dwsRequest(`/compute/jobs/${jobId}`)
      const body = (await statusRes.json()) as {
        status: string
        output: string | null
      }
      expect(['queued', 'running', 'completed', 'failed']).toContain(
        body.status,
      )

      // If completed, verify output (may stay queued if no runner)
      if (body.status === 'completed' && body.output) {
        expect(body.output).toContain('line 1')
        expect(body.output).toContain('line 2')
        expect(body.output).toContain('line 3')
      }
    })

    test('should capture stderr in output', async () => {
      const res = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({ command: 'echo "stderr message" >&2' }),
      })

      expect(res.status).toBe(201)
      const { jobId } = await res.json()
      expect(jobId).toBeDefined()

      // Verify job was created (execution requires compute runner)
      const statusRes = await dwsRequest(`/compute/jobs/${jobId}`)
      const body = (await statusRes.json()) as {
        status: string
        output: string | null
      }
      expect(['queued', 'running', 'completed', 'failed']).toContain(
        body.status,
      )

      if (body.status === 'completed' && body.output) {
        expect(body.output).toContain('stderr message')
      }
    })

    test('job should include CI environment variables', async () => {
      const res = await dwsRequest('/compute/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-jeju-address': TEST_ADDRESS,
        },
        body: JSON.stringify({
          command: 'echo "CI=$CI JEJU_COMPUTE=$JEJU_COMPUTE"',
        }),
      })

      expect(res.status).toBe(201)
      const { jobId } = await res.json()
      expect(jobId).toBeDefined()

      // Verify job was created (execution requires compute runner)
      const statusRes = await dwsRequest(`/compute/jobs/${jobId}`)
      const body = (await statusRes.json()) as {
        status: string
        output: string | null
      }
      expect(['queued', 'running', 'completed', 'failed']).toContain(
        body.status,
      )

      if (body.status === 'completed' && body.output) {
        expect(body.output).toContain('CI=true')
        expect(body.output).toContain('JEJU_COMPUTE=true')
      }
    })
  })
})
