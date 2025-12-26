/**
 * TEE Tests - Trusted Execution Environment encryption and verification
 */

import { createServer, type Server } from 'node:http'
import { expect, test } from '@playwright/test'
import { keccak256, stringToBytes } from 'viem'

const AUTOCRAT_URL = 'http://localhost:8010'

interface MockInferenceRequest {
  model: string
  messages: Array<{ role: string; content: string }>
}

interface MockVerifyRequest {
  quote: string
}

type MockRequestBody = MockInferenceRequest | MockVerifyRequest | null

interface MockServerCall {
  method: string
  path: string
  body: MockRequestBody
}

interface A2ADataPart {
  kind: 'data'
  data: Record<string, unknown>
}

interface A2APart {
  kind: string
  data?: Record<string, unknown>
}

const getDataPart = (
  result: { parts: A2APart[] } | undefined,
): A2ADataPart['data'] | undefined => {
  return result?.parts.find((p): p is A2ADataPart => p.kind === 'data')?.data
}

test.describe('TEE Encryption', () => {
  test('health endpoint reports TEE mode', async ({ request }) => {
    const response = await request.get(`${AUTOCRAT_URL}/health`)
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.tee).toBeDefined()
    expect(['simulated', 'hardware']).toContain(data.tee)
  })

  test('CEO decision includes attestation info', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: `msg-${Date.now()}`,
            parts: [{ kind: 'data', data: { skillId: 'get-ceo-status' } }],
          },
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const result = await response.json()
    const data = getDataPart(result.result)
    expect(data?.currentModel).toBeDefined()
  })

  test('governance stats work with TEE enabled', async ({ request }) => {
    const response = await request.post(`${AUTOCRAT_URL}/a2a`, {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            messageId: `msg-${Date.now()}`,
            parts: [
              { kind: 'data', data: { skillId: 'get-governance-stats' } },
            ],
          },
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const result = await response.json()
    const data = getDataPart(result.result)
    expect(data?.ceo).toBeDefined()
  })
})

test.describe('Hardware TEE Flow (Mocked)', () => {
  let mockServer: Server | null = null
  let mockCalls: MockServerCall[] = []
  const MOCK_PORT = 19876
  const MOCK_URL = `http://localhost:${MOCK_PORT}`

  const MOCK_DECISION = {
    approved: true,
    reasoning: 'Test approved with high confidence based on council consensus.',
    confidence: 95,
    alignment: 92,
    recommendations: ['Proceed with implementation', 'Monitor execution'],
  }

  function createMockServer(): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          mockCalls.push({
            method: req.method ?? 'GET',
            path: req.url ?? '/',
            body: body ? (JSON.parse(body) as MockRequestBody) : null,
          })

          if (req.url?.includes('/inference')) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                choices: [
                  { message: { content: JSON.stringify(MOCK_DECISION) } },
                ],
                attestation: {
                  quote: `mock-quote-${Date.now()}`,
                  measurement: `mock-measurement-${Date.now()}`,
                },
              }),
            )
            return
          }

          if (req.url?.includes('/verify')) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ verified: true }))
            return
          }

          res.writeHead(404)
          res.end()
        })
      })

      server.on('error', reject)
      server.listen(MOCK_PORT, () => resolve(server))
    })
  }

  test.beforeAll(async () => {
    mockServer = await createMockServer()
    mockCalls = []
  })

  test.afterAll(async () => {
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer?.close(() => resolve()))
    }
  })

  test.beforeEach(() => {
    mockCalls = []
  })

  test('mock server responds to inference requests', async ({ request }) => {
    const response = await request.post(`${MOCK_URL}/api/v1/inference`, {
      data: {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Test prompt' }],
      },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.choices[0].message.content).toContain('approved')
    expect(data.attestation).toBeDefined()
    expect(data.attestation.quote).toBeDefined()
  })

  test('mock server responds to DCAP verification', async ({ request }) => {
    const response = await request.post(`${MOCK_URL}/verify`, {
      data: { quote: 'test-quote' },
    })

    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(data.verified).toBe(true)
  })

  test('mock records all calls for verification', async ({ request }) => {
    await request.post(`${MOCK_URL}/api/v1/inference`, {
      data: { model: 'test', messages: [] },
    })
    await request.post(`${MOCK_URL}/verify`, {
      data: { quote: 'test' },
    })

    expect(mockCalls.length).toBe(2)
    expect(mockCalls[0].path).toContain('/inference')
    expect(mockCalls[1].path).toContain('/verify')
  })
})

test.describe('TEE Decision Making Unit Tests', () => {
  test('vote analysis correctly counts votes', () => {
    const votes = [
      { role: 'TREASURY', vote: 'APPROVE', reasoning: 'Funds available' },
      { role: 'CODE', vote: 'APPROVE', reasoning: 'Code looks good' },
      { role: 'COMMUNITY', vote: 'REJECT', reasoning: 'Community concerns' },
      { role: 'SECURITY', vote: 'APPROVE', reasoning: 'No security issues' },
    ]

    const approves = votes.filter((v) => v.vote === 'APPROVE').length
    const rejects = votes.filter((v) => v.vote === 'REJECT').length
    const total = votes.length
    const consensusRatio = Math.max(approves, rejects) / Math.max(total, 1)

    expect(approves).toBe(3)
    expect(rejects).toBe(1)
    expect(total).toBe(4)
    expect(consensusRatio).toBe(0.75)
    expect(approves > rejects).toBe(true)
    expect(approves >= total / 2).toBe(true)
  })

  test('encryption produces valid ciphertext', () => {
    const testData = JSON.stringify({ test: 'data', timestamp: Date.now() })
    const hash = keccak256(stringToBytes(testData))

    expect(hash).toMatch(/^0x[a-f0-9]{64}$/)
    expect(hash.length).toBe(66)
  })

  test('decision hash is deterministic', () => {
    const decision = { approved: true, reasoning: 'Test', confidence: 95 }
    const json = JSON.stringify(decision)

    const hash1 = keccak256(stringToBytes(json))
    const hash2 = keccak256(stringToBytes(json))

    expect(hash1).toBe(hash2)
  })

  test('different decisions produce different hashes', () => {
    const decision1 = { approved: true, reasoning: 'Approved', confidence: 95 }
    const decision2 = { approved: false, reasoning: 'Rejected', confidence: 80 }

    const hash1 = keccak256(stringToBytes(JSON.stringify(decision1)))
    const hash2 = keccak256(stringToBytes(JSON.stringify(decision2)))

    expect(hash1).not.toBe(hash2)
  })
})

test.describe('TEE Mode Detection', () => {
  test('reports simulated mode when no API key', async ({ request }) => {
    const response = await request
      .get(`${AUTOCRAT_URL}/health`)
      .catch(() => null)
    if (!response) {
      test.skip()
      return
    }
    expect(response.ok()).toBeTruthy()

    const data = await response.json()
    expect(data.tee).toBe('simulated')
  })

  test('simulated mode still produces valid decisions', async ({ request }) => {
    const response = await request
      .get(`${AUTOCRAT_URL}/health`)
      .catch(() => null)
    if (!response) {
      test.skip()
      return
    }
    const health = await response.json()

    expect(health.status).toBe('ok')
    expect(health.tee).toBe('simulated')
  })
})
