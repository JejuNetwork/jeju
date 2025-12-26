/**
 * StaticTrajectoryStorage Tests
 *
 * Tests buffering, compression, upload, and retrieval of trajectory data.
 * Covers:
 * - Buffer management (add, flush, limits)
 * - JSONL format and gzip compression
 * - Upload with retry logic
 * - Edge cases and error handling
 * - Concurrent operations
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { LLMCallLogRecord, TrajectoryRecord } from '../recording/trajectory-recorder'
import {
  createStaticTrajectoryStorage,
  downloadTrajectoryBatch,
  getStaticTrajectoryStorage,
  shutdownAllStaticStorage,
  StaticTrajectoryStorage,
  type TrajectoryBatchReference,
} from '../storage/static-storage'

// Test Fixtures

function createTestTrajectoryRecord(
  overrides: Partial<TrajectoryRecord> = {},
): TrajectoryRecord {
  const now = new Date()
  const nowMs = now.getTime()
  return {
    id: `traj-${Math.random().toString(36).slice(2)}`,
    trajectoryId: `traj-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    agentId: 'test-agent-1',
    archetype: 'trader',
    scenarioId: 'test-scenario',
    windowId: 'window-1',
    windowHours: 1,
    episodeId: 'ep-1',
    startTime: now,
    endTime: new Date(nowMs + 60000),
    durationMs: 60000,
    totalReward: 0.75,
    steps: [
      {
        stepId: 'step-1',
        stepNumber: 0,
        timestamp: now,
        environmentState: {
          timestamp: nowMs,
          agentBalance: 1000,
          agentPoints: 100,
          agentPnL: 50,
          openPositions: 2,
        },
        action: {
          actionType: 'buy',
          parameters: { symbol: 'ETH', amount: 1 },
          success: true,
          error: undefined,
        },
        reward: 0.5,
        cumulativeReward: 0.5,
      },
      {
        stepId: 'step-2',
        stepNumber: 1,
        timestamp: new Date(nowMs + 30000),
        environmentState: {
          timestamp: nowMs + 30000,
          agentBalance: 1100,
          agentPoints: 110,
          agentPnL: 100,
          openPositions: 1,
        },
        action: {
          actionType: 'sell',
          parameters: { symbol: 'ETH', amount: 1 },
          success: true,
          error: undefined,
        },
        reward: 0.25,
        cumulativeReward: 0.75,
      },
    ],
    rewardComponents: {
      environmentReward: 0.75,
    },
    metrics: {
      episodeLength: 2,
      finalStatus: 'complete',
      tradesExecuted: 2,
      postsCreated: 0,
      errorCount: 0,
    },
    metadata: {
      isTrainingData: true,
      gameKnowledge: undefined,
    },
    ...overrides,
  }
}

function createTestLLMCallLog(
  trajectoryId: string,
  stepId: string,
): LLMCallLogRecord {
  return {
    id: `llm-${Math.random().toString(36).slice(2)}`,
    trajectoryId,
    stepId,
    callId: `call-${Date.now()}`,
    timestamp: new Date(),
    latencyMs: 150,
    model: 'test-model',
    purpose: 'action',
    actionType: 'buy',
    systemPrompt: 'You are a trading agent.',
    userPrompt: 'Analyze the market and decide.',
    messages: [
      { role: 'system', content: 'You are a trading agent.' },
      { role: 'user', content: 'Analyze the market and decide.' },
    ],
    response: 'I will buy ETH.',
    reasoning: 'Market looks bullish.',
    temperature: 0.7,
    maxTokens: 1024,
    metadata: {},
  }
}

// Mock fetch for DWS upload
let mockFetchResponses: Array<{ ok: boolean; status: number; body: Record<string, unknown> | string }> = []
let fetchCalls: Array<{ url: string; options: RequestInit }> = []

const originalFetch = globalThis.fetch
function setupMockFetch() {
  fetchCalls = []
  // @ts-expect-error - mock fetch doesn't need preconnect
  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlString = url.toString()
    fetchCalls.push({ url: urlString, options: options ?? {} })

    const mockResponse = mockFetchResponses.shift()
    if (!mockResponse) {
      throw new Error(`No mock response for fetch: ${urlString}`)
    }

    return {
      ok: mockResponse.ok,
      status: mockResponse.status,
      text: async () =>
        typeof mockResponse.body === 'string'
          ? mockResponse.body
          : JSON.stringify(mockResponse.body),
      json: async () => mockResponse.body,
      arrayBuffer: async () => {
        if (mockResponse.body instanceof ArrayBuffer) {
          return mockResponse.body
        }
        const text = typeof mockResponse.body === 'string'
          ? mockResponse.body
          : JSON.stringify(mockResponse.body)
        return new TextEncoder().encode(text).buffer
      },
    } as Response
  }
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

// Test Suite

describe('StaticTrajectoryStorage', () => {
  beforeEach(() => {
    mockFetchResponses = []
    fetchCalls = []
    setupMockFetch()
  })

  afterEach(async () => {
    restoreFetch()
    await shutdownAllStaticStorage()
  })

  describe('Constructor and Configuration', () => {
    test('creates storage with default config', () => {
      const storage = new StaticTrajectoryStorage({ appName: 'test-app' })
      expect(storage).toBeDefined()
    })

    test('uses provided config values', () => {
      const storage = new StaticTrajectoryStorage({
        appName: 'custom-app',
        maxBufferSize: 50,
        maxBufferAgeMs: 30000,
        usePermanentStorage: true,
      })

      const stats = storage.getBufferStats()
      expect(stats.count).toBe(0)
      expect(stats.ageMs).toBeNull()
    })

    test('creates singleton instances via factory', () => {
      const storage1 = getStaticTrajectoryStorage('singleton-test')
      const storage2 = getStaticTrajectoryStorage('singleton-test')
      expect(storage1).toBe(storage2)

      const storage3 = getStaticTrajectoryStorage('different-app')
      expect(storage3).not.toBe(storage1)
    })
  })

  describe('Buffer Management', () => {
    test('buffers trajectories without immediate flush', async () => {
      const storage = new StaticTrajectoryStorage({
        appName: 'buffer-test',
        maxBufferSize: 10,
        maxBufferAgeMs: 60000,
      })

      const trajectory = createTestTrajectoryRecord()
      await storage.saveTrajectory(trajectory)

      const stats = storage.getBufferStats()
      expect(stats.count).toBe(1)
      expect(stats.oldestTrajectoryId).toBe(trajectory.trajectoryId)
      expect(stats.ageMs).toBeGreaterThanOrEqual(0)
    })

    test('auto-flushes when buffer size limit reached', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmTest123' },
      })

      let flushedBatch: TrajectoryBatchReference | null = null
      const storage = new StaticTrajectoryStorage({
        appName: 'auto-flush-test',
        maxBufferSize: 2,
        maxBufferAgeMs: 60000,
        onBatchFlushed: async (batch) => {
          flushedBatch = batch
        },
      })

      const traj1 = createTestTrajectoryRecord()
      const traj2 = createTestTrajectoryRecord()

      await storage.saveTrajectory(traj1)
      expect(storage.getBufferStats().count).toBe(1)

      await storage.saveTrajectory(traj2)

      // Should have auto-flushed
      expect(storage.getBufferStats().count).toBe(0)
      expect(flushedBatch).not.toBeNull()
      expect(flushedBatch!.trajectoryCount).toBe(2)
      expect(flushedBatch!.storageCid).toBe('QmTest123')
    })

    test('associates LLM calls with trajectories', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmWithLLM' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'llm-test',
        maxBufferSize: 1,
      })

      const trajectory = createTestTrajectoryRecord()
      await storage.saveTrajectory(trajectory)

      const llmCall = createTestLLMCallLog(trajectory.trajectoryId, 'step-1')
      await storage.saveLLMCallLogs([llmCall])

      // Trigger flush
      const batch = await storage.flush()

      expect(batch).not.toBeNull()
      expect(fetchCalls.length).toBe(1)

      // Verify the uploaded content includes LLM calls
      const uploadCall = fetchCalls[0]!
      expect(uploadCall.url).toContain('/api/v1/upload')
    })

    test('handles empty buffer flush gracefully', async () => {
      const storage = new StaticTrajectoryStorage({ appName: 'empty-test' })

      const batch = await storage.flush()
      expect(batch).toBeNull()
    })

    test('prevents concurrent flushes', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmConcurrent' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'concurrent-test',
        maxBufferSize: 100,
      })

      const traj = createTestTrajectoryRecord()
      await storage.saveTrajectory(traj)

      // Start two flushes concurrently
      const flush1 = storage.flush()
      const flush2 = storage.flush()

      const [result1, result2] = await Promise.all([flush1, flush2])

      // One should succeed, one should return null (already flushing)
      const results = [result1, result2].filter((r) => r !== null)
      expect(results.length).toBe(1)
    })
  })

  describe('JSONL Format and Compression', () => {
    test('creates valid JSONL with header', async () => {
      let uploadedData: Buffer | null = null
      const origFetch = globalThis.fetch
      // @ts-expect-error - mock fetch doesn't need preconnect
      globalThis.fetch = async (_url: string | URL | Request, options?: RequestInit) => {
        const body = options?.body as FormData
        if (body instanceof FormData) {
          const file = body.get('file') as Blob
          if (file) {
            uploadedData = Buffer.from(await file.arrayBuffer())
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ cid: 'QmJsonlTest' }),
        } as Response
      }

      const storage = new StaticTrajectoryStorage({
        appName: 'jsonl-test',
        maxBufferSize: 1,
      })

      const trajectory = createTestTrajectoryRecord({ archetype: 'test-archetype' })
      await storage.saveTrajectory(trajectory)
      await storage.flush()

      globalThis.fetch = origFetch

      expect(uploadedData).not.toBeNull()

      // Decompress and parse
      const decompressed = gunzipSync(uploadedData!).toString('utf8')
      const lines = decompressed.split('\n').filter((l) => l.trim())

      expect(lines.length).toBeGreaterThanOrEqual(2) // Header + at least 1 trajectory

      // Verify header
      const header = JSON.parse(lines[0]!)
      expect(header._type).toBe('header')
      expect(header.appName).toBe('jsonl-test')
      expect(header.trajectoryCount).toBe(1)

      // Verify trajectory
      const trajLine = JSON.parse(lines[1]!)
      expect(trajLine._type).toBe('trajectory')
      expect(trajLine.agentId).toBe('test-agent-1')
      expect(trajLine.archetype).toBe('test-archetype')
    })

    test('compression achieves significant size reduction', async () => {
      let compressedSize = 0
      let uncompressedSize = 0

      const origFetch = globalThis.fetch
      // @ts-expect-error - mock fetch doesn't need preconnect
      globalThis.fetch = async (_url: string | URL | Request, options?: RequestInit) => {
        const body = options?.body as FormData
        if (body instanceof FormData) {
          const file = body.get('file') as Blob
          if (file) {
            compressedSize = file.size
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ cid: 'QmCompression' }),
        } as Response
      }

      const storage = new StaticTrajectoryStorage({
        appName: 'compression-test',
        maxBufferSize: 10,
      })

      // Add multiple trajectories to get meaningful compression ratio
      for (let i = 0; i < 5; i++) {
        const traj = createTestTrajectoryRecord()
        await storage.saveTrajectory(traj)
        uncompressedSize += JSON.stringify(traj).length
      }

      const batch = await storage.flush()
      globalThis.fetch = origFetch

      expect(batch).not.toBeNull()
      expect(compressedSize).toBeGreaterThan(0)

      // Compression should achieve at least 2x reduction for JSON
      const ratio = uncompressedSize / compressedSize
      expect(ratio).toBeGreaterThan(2)
    })
  })

  describe('Upload with Retry Logic', () => {
    test('succeeds on first try', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmFirstTry' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'retry-test',
        maxBufferSize: 1,
      })

      await storage.saveTrajectory(createTestTrajectoryRecord())
      const batch = await storage.flush()

      expect(batch?.storageCid).toBe('QmFirstTry')
      expect(fetchCalls.length).toBe(1)
    })

    test('retries on 5xx errors', async () => {
      mockFetchResponses.push({
        ok: false,
        status: 500,
        body: 'Internal Server Error',
      })
      mockFetchResponses.push({
        ok: false,
        status: 503,
        body: 'Service Unavailable',
      })
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmRetrySuccess' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'retry-5xx-test',
        maxBufferSize: 1,
      })

      await storage.saveTrajectory(createTestTrajectoryRecord())
      const batch = await storage.flush()

      expect(batch?.storageCid).toBe('QmRetrySuccess')
      expect(fetchCalls.length).toBe(3)
    })

    test('retries on rate limiting (429)', async () => {
      mockFetchResponses.push({
        ok: false,
        status: 429,
        body: 'Too Many Requests',
      })
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmRateLimited' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'retry-429-test',
        maxBufferSize: 1,
      })

      await storage.saveTrajectory(createTestTrajectoryRecord())
      const batch = await storage.flush()

      expect(batch?.storageCid).toBe('QmRateLimited')
      expect(fetchCalls.length).toBe(2)
    })

    test('throws after max retries exceeded', async () => {
      mockFetchResponses.push({ ok: false, status: 500, body: 'Error' })
      mockFetchResponses.push({ ok: false, status: 500, body: 'Error' })
      mockFetchResponses.push({ ok: false, status: 500, body: 'Error' })

      const storage = new StaticTrajectoryStorage({
        appName: 'retry-fail-test',
        maxBufferSize: 1,
      })

      await storage.saveTrajectory(createTestTrajectoryRecord())

      await expect(storage.flush()).rejects.toThrow('DWS upload failed')
    })

    test('does not retry on 4xx errors (except 429)', async () => {
      mockFetchResponses.push({
        ok: false,
        status: 400,
        body: 'Bad Request',
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'no-retry-4xx-test',
        maxBufferSize: 1,
      })

      await storage.saveTrajectory(createTestTrajectoryRecord())

      await expect(storage.flush()).rejects.toThrow('DWS upload failed: 400')
      expect(fetchCalls.length).toBe(1)
    })

    test('retries on network errors', async () => {
      let callCount = 0
      const origFetch = globalThis.fetch
      // @ts-expect-error - mock fetch doesn't need preconnect
      globalThis.fetch = async () => {
        callCount++
        if (callCount < 3) {
          throw new Error('Network error')
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ cid: 'QmNetworkRecovered' }),
        } as Response
      }

      const storage = new StaticTrajectoryStorage({
        appName: 'network-error-test',
        maxBufferSize: 1,
      })

      await storage.saveTrajectory(createTestTrajectoryRecord())
      const batch = await storage.flush()

      globalThis.fetch = origFetch

      expect(batch?.storageCid).toBe('QmNetworkRecovered')
      expect(callCount).toBe(3)
    })
  })

  describe('Edge Cases', () => {
    test('handles trajectory with no steps', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmNoSteps' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'no-steps-test',
        maxBufferSize: 1,
      })

      const traj = createTestTrajectoryRecord({ steps: [] })
      await storage.saveTrajectory(traj)
      const batch = await storage.flush()

      expect(batch?.totalSteps).toBe(0)
    })

    test('handles mixed archetypes in single batch', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmMixedArchetypes' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'mixed-archetype-test',
        maxBufferSize: 3,
      })

      await storage.saveTrajectory(createTestTrajectoryRecord({ archetype: 'trader' }))
      await storage.saveTrajectory(createTestTrajectoryRecord({ archetype: 'degen' }))
      await storage.saveTrajectory(createTestTrajectoryRecord({ archetype: 'researcher' }))

      const batch = await storage.flush()

      // Mixed archetypes should result in null archetype for batch
      expect(batch?.archetype).toBeNull()
      expect(batch?.trajectoryCount).toBe(3)
    })

    test('handles null archetype trajectories', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmNullArchetype' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'null-archetype-test',
        maxBufferSize: 1,
      })

      await storage.saveTrajectory(createTestTrajectoryRecord({ archetype: null }))
      const batch = await storage.flush()

      expect(batch?.archetype).toBeNull()
    })

    test('handles very large trajectories', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmLargeTraj' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'large-traj-test',
        maxBufferSize: 1,
      })

      // Create trajectory with many steps
      const steps = Array.from({ length: 100 }, (_, i) => ({
        stepId: `step-${i}`,
        stepNumber: i,
        timestamp: new Date(),
        environmentState: {
          timestamp: Date.now(),
          agentBalance: 1000 + i,
          agentPoints: i,
          agentPnL: i * 10,
          openPositions: i % 5,
        },
        action: {
          actionType: i % 2 === 0 ? 'buy' : 'sell',
          parameters: { amount: i },
          success: true,
          error: null,
        },
        reward: Math.random(),
        cumulativeReward: i * 0.1,
      }))

      await storage.saveTrajectory(createTestTrajectoryRecord({ steps }))
      const batch = await storage.flush()

      expect(batch?.totalSteps).toBe(100)
    })

    test('validates upload response has cid', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { error: 'No CID' }, // Missing cid field
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'invalid-response-test',
        maxBufferSize: 1,
      })

      await storage.saveTrajectory(createTestTrajectoryRecord())

      await expect(storage.flush()).rejects.toThrow('Invalid DWS upload response')
    })
  })

  describe('Batch Reference Accuracy', () => {
    test('calculates correct totals', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmTotals' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'totals-test',
        maxBufferSize: 3,
      })

      const traj1 = createTestTrajectoryRecord({ totalReward: 0.5 })
      const traj2 = createTestTrajectoryRecord({ totalReward: 0.7 })
      const traj3 = createTestTrajectoryRecord({ totalReward: 0.3 })

      await storage.saveTrajectory(traj1)
      await storage.saveTrajectory(traj2)
      await storage.saveTrajectory(traj3)

      const batch = await storage.flush()

      expect(batch?.trajectoryCount).toBe(3)
      expect(batch?.totalSteps).toBe(6) // 2 steps per trajectory
      expect(batch?.totalReward).toBeCloseTo(1.5, 2)
      expect(batch?.trajectoryIds).toHaveLength(3)
    })

    test('tracks time window correctly', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmTimeWindow' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'time-window-test',
        maxBufferSize: 3,
      })

      const now = Date.now()
      const traj1 = createTestTrajectoryRecord({
        startTime: new Date(now - 3600000), // 1 hour ago
        endTime: new Date(now - 3000000),
      })
      const traj2 = createTestTrajectoryRecord({
        startTime: new Date(now - 1800000), // 30 min ago
        endTime: new Date(now - 1200000),
      })
      const traj3 = createTestTrajectoryRecord({
        startTime: new Date(now - 600000), // 10 min ago
        endTime: new Date(now),
      })

      await storage.saveTrajectory(traj1)
      await storage.saveTrajectory(traj2)
      await storage.saveTrajectory(traj3)

      const batch = await storage.flush()

      expect(batch?.timeWindowStart.getTime()).toBe(now - 3600000)
      expect(batch?.timeWindowEnd.getTime()).toBe(now)
    })
  })

  describe('Shutdown Behavior', () => {
    test('flushes remaining data on shutdown', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { cid: 'QmShutdown' },
      })

      const storage = new StaticTrajectoryStorage({
        appName: 'shutdown-test',
        maxBufferSize: 100, // High limit so won't auto-flush
      })

      await storage.saveTrajectory(createTestTrajectoryRecord())
      expect(storage.getBufferStats().count).toBe(1)

      await storage.shutdown()
      expect(storage.getBufferStats().count).toBe(0)
    })

    test('shutdown is idempotent with empty buffer', async () => {
      const storage = new StaticTrajectoryStorage({ appName: 'shutdown-empty-test' })

      await storage.shutdown()
      await storage.shutdown() // Should not throw

      expect(storage.getBufferStats().count).toBe(0)
    })
  })
})

describe('downloadTrajectoryBatch', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('downloads and parses valid batch', async () => {
    // Create mock compressed JSONL
    const jsonlContent = [
      '{"_type":"header","batchId":"test-batch","appName":"test","trajectoryCount":1,"timestamp":"2024-01-01T00:00:00Z"}',
      '{"_type":"trajectory","trajectoryId":"traj-1","agentId":"agent-1","archetype":"trader","appName":"test","startTime":"2024-01-01T00:00:00Z","endTime":"2024-01-01T00:01:00Z","durationMs":60000,"windowId":"w1","scenarioId":"s1","steps":[],"rewardComponents":{},"metrics":{},"metadata":{},"totalReward":0.5}',
      '{"_type":"llm_call","id":"llm-1","trajectoryId":"traj-1","stepId":"step-1","callId":"call-1","timestamp":"2024-01-01T00:00:00Z","latencyMs":100,"model":"test","purpose":"action","actionType":"buy","systemPrompt":"sys","userPrompt":"usr","messages":[],"response":"resp","reasoning":null,"temperature":0.7,"maxTokens":1024,"metadata":{}}',
    ].join('\n')

    const compressed = gzipSync(Buffer.from(jsonlContent))

    // @ts-expect-error - mock fetch doesn't need preconnect
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => compressed.buffer.slice(
        compressed.byteOffset,
        compressed.byteOffset + compressed.byteLength,
      ),
    }) as Response

    const result = await downloadTrajectoryBatch('QmTestCid', 'http://test-endpoint')

    expect(result.header.batchId).toBe('test-batch')
    expect(result.header.appName).toBe('test')
    expect(result.trajectories).toHaveLength(1)
    expect(result.trajectories[0]!.trajectoryId).toBe('traj-1')
    expect(result.llmCalls).toHaveLength(1)
    expect(result.llmCalls[0]!.trajectoryId).toBe('traj-1')
  })

  test('throws on download failure', async () => {
    // @ts-expect-error - mock fetch doesn't need preconnect
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
    }) as Response

    await expect(
      downloadTrajectoryBatch('QmNotFound', 'http://test-endpoint'),
    ).rejects.toThrow('Failed to download batch: 404')
  })

  test('throws on missing header', async () => {
    const jsonlContent = '{"_type":"trajectory","trajectoryId":"traj-1"}'
    const compressed = gzipSync(Buffer.from(jsonlContent))

    // @ts-expect-error - mock fetch doesn't need preconnect
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => compressed.buffer.slice(
        compressed.byteOffset,
        compressed.byteOffset + compressed.byteLength,
      ),
    }) as Response

    await expect(
      downloadTrajectoryBatch('QmNoHeader', 'http://test-endpoint'),
    ).rejects.toThrow('Invalid batch: missing header')
  })
})

describe('Factory Functions', () => {
  afterEach(async () => {
    await shutdownAllStaticStorage()
  })

  test('createStaticTrajectoryStorage creates new instance', () => {
    const storage1 = createStaticTrajectoryStorage('app1')
    const storage2 = createStaticTrajectoryStorage('app1')

    // Each call creates a new instance
    expect(storage1).not.toBe(storage2)
  })

  test('getStaticTrajectoryStorage returns singleton', () => {
    const storage1 = getStaticTrajectoryStorage('singleton-app')
    const storage2 = getStaticTrajectoryStorage('singleton-app')

    expect(storage1).toBe(storage2)
  })

  test('shutdownAllStaticStorage clears all instances', async () => {
    mockFetchResponses.push({ ok: true, status: 200, body: { cid: 'QmClear' } })
    setupMockFetch()

    const storage = getStaticTrajectoryStorage('clear-test')
    await storage.saveTrajectory(createTestTrajectoryRecord())

    await shutdownAllStaticStorage()

    // Getting same app name should create new instance
    const newStorage = getStaticTrajectoryStorage('clear-test')
    expect(newStorage.getBufferStats().count).toBe(0)
  })
})
