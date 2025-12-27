/**
 * TrajectoryBatchProcessor Tests
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { gzipSync } from 'node:zlib'
import {
  createBatchProcessor,
  type DatasetReference,
  downloadScoredDataset,
  TrajectoryBatchProcessor,
} from '../api/training/batch-processor'

// Test Fixtures

function createMockTrajectoryJSONL(
  trajectories: Array<{
    trajectoryId: string
    agentId: string
    archetype: string
    totalReward: number
    steps?: Array<{
      stepNumber: number
      timestamp: number
      action?: { actionType: string; success: boolean; timestamp: number }
      reward?: number
    }>
  }>,
): string {
  const nowMs = Date.now()
  const header = JSON.stringify({
    _type: 'header',
    batchId: 'test-batch',
    appName: 'test-app',
    trajectoryCount: trajectories.length,
    timestamp: new Date().toISOString(),
  })

  const trajLines = trajectories.map((t, idx) =>
    JSON.stringify({
      _type: 'trajectory',
      id: t.trajectoryId, // Schema expects 'id' field
      trajectoryId: t.trajectoryId,
      agentId: t.agentId,
      archetype: t.archetype,
      appName: 'test-app',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMs: 60000,
      windowId: 'w1',
      scenarioId: 's1',
      steps: t.steps ?? [
        {
          stepNumber: 0,
          timestamp: nowMs,
          action: { actionType: 'buy', success: true, timestamp: nowMs },
          reward: t.totalReward,
        },
      ],
      rewardComponents: [], // Schema expects array, not object
      metrics: {},
      metadata: {},
      totalReward: t.totalReward,
    }),
  )

  return [header, ...trajLines].join('\n')
}

function createCompressedBatch(jsonlContent: string): ArrayBuffer {
  const compressed = gzipSync(Buffer.from(jsonlContent))
  return compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  )
}

// Mock fetch
let mockFetchResponses: Map<
  string,
  {
    ok: boolean
    status: number
    body: ArrayBuffer | Record<string, unknown> | string
  }
> = new Map()
let fetchCalls: Array<{ url: string; method: string }> = []

const originalFetch = globalThis.fetch
function setupMockFetch() {
  fetchCalls = []
  globalThis.fetch = async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    const urlString = url.toString()
    const method = options?.method ?? 'GET'
    fetchCalls.push({ url: urlString, method })

    // Match by URL pattern
    for (const [pattern, response] of mockFetchResponses) {
      if (urlString.includes(pattern)) {
        return {
          ok: response.ok,
          status: response.status,
          text: async () =>
            typeof response.body === 'string'
              ? response.body
              : response.body instanceof ArrayBuffer
                ? new TextDecoder().decode(response.body)
                : JSON.stringify(response.body),
          json: async () =>
            response.body instanceof ArrayBuffer
              ? JSON.parse(new TextDecoder().decode(response.body))
              : response.body,
          arrayBuffer: async () =>
            response.body instanceof ArrayBuffer
              ? response.body
              : new TextEncoder().encode(
                  typeof response.body === 'string'
                    ? response.body
                    : JSON.stringify(response.body),
                ).buffer,
        } as Response
      }
    }

    throw new Error(`No mock response for: ${urlString}`)
  }
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

// Mock scoring service responses - returns RULER format (array of scores)
// Note: scoring service expects trajectory-1, trajectory-2, etc. in responses
function setupMockScoringResponses() {
  mockFetchResponses.set('/v1/chat/completions', {
    ok: true,
    status: 200,
    body: {
      choices: [
        {
          message: {
            content: JSON.stringify({
              scores: [
                {
                  trajectory_id: 'trajectory-1',
                  explanation: 'Good strategy',
                  score: 0.8,
                },
                {
                  trajectory_id: 'trajectory-2',
                  explanation: 'Average performance',
                  score: 0.6,
                },
                {
                  trajectory_id: 'trajectory-3',
                  explanation: 'Needs improvement',
                  score: 0.4,
                },
                {
                  trajectory_id: 'trajectory-4',
                  explanation: 'Solid execution',
                  score: 0.7,
                },
              ],
            }),
          },
        },
      ],
    },
  })
}

// Test Suite

describe('TrajectoryBatchProcessor', () => {
  beforeEach(() => {
    mockFetchResponses = new Map()
    fetchCalls = []
    setupMockFetch()
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('Constructor and Configuration', () => {
    test('creates processor with default config', () => {
      const processor = createBatchProcessor()
      expect(processor).toBeDefined()
    })

    test('uses custom config values', () => {
      const processor = new TrajectoryBatchProcessor({
        rulerModelId: 'custom-model',
        maxTrajectoriesPerBatch: 50,
        minTrajectoriesForRuler: 5,
      })
      expect(processor).toBeDefined()
    })

    test('accepts onDatasetCreated callback', async () => {
      let _createdDataset: DatasetReference | null = null
      const processor = new TrajectoryBatchProcessor({
        onDatasetCreated: async (dataset) => {
          _createdDataset = dataset
        },
      })
      expect(processor).toBeDefined()
    })
  })

  describe('Batch Download', () => {
    test('downloads and parses batch from CID', async () => {
      const jsonl = createMockTrajectoryJSONL([
        {
          trajectoryId: 't1',
          agentId: 'a1',
          archetype: 'trader',
          totalReward: 0.5,
        },
      ])
      const compressed = createCompressedBatch(jsonl)

      mockFetchResponses.set('/storage/download/', {
        ok: true,
        status: 200,
        body: compressed,
      })
      setupMockScoringResponses()
      mockFetchResponses.set('/api/v1/upload', {
        ok: true,
        status: 200,
        body: { cid: 'QmResult' },
      })

      const processor = createBatchProcessor({ minTrajectoriesForRuler: 1 })
      const _datasets = await processor.processBatches(
        ['QmTestBatch'],
        'test-app',
      )

      // Should have made download request
      const downloadCall = fetchCalls.find((c) =>
        c.url.includes('/storage/download/'),
      )
      expect(downloadCall).toBeDefined()
    })

    test('handles download failure', async () => {
      mockFetchResponses.set('/storage/download/', {
        ok: false,
        status: 404,
        body: 'Not Found',
      })

      const processor = createBatchProcessor()

      await expect(
        processor.processBatches(['QmNotFound'], 'test-app'),
      ).rejects.toThrow()
    })
  })

  describe('Archetype Grouping', () => {
    test('groups trajectories by archetype', async () => {
      const jsonl = createMockTrajectoryJSONL([
        {
          trajectoryId: 't1',
          agentId: 'a1',
          archetype: 'trader',
          totalReward: 0.5,
        },
        {
          trajectoryId: 't2',
          agentId: 'a2',
          archetype: 'trader',
          totalReward: 0.7,
        },
        {
          trajectoryId: 't3',
          agentId: 'a3',
          archetype: 'degen',
          totalReward: 0.3,
        },
        {
          trajectoryId: 't4',
          agentId: 'a4',
          archetype: 'degen',
          totalReward: 0.4,
        },
      ])
      const compressed = createCompressedBatch(jsonl)

      mockFetchResponses.set('/storage/download/', {
        ok: true,
        status: 200,
        body: compressed,
      })
      setupMockScoringResponses()
      mockFetchResponses.set('/api/v1/upload', {
        ok: true,
        status: 200,
        body: { cid: 'QmGrouped' },
      })

      const processor = createBatchProcessor({ minTrajectoriesForRuler: 2 })
      const datasets = await processor.processBatches(['QmMixed'], 'test-app')

      // Should create separate datasets for each archetype
      expect(datasets.length).toBe(2)
      const archetypes = datasets.map((d) => d.archetype)
      expect(archetypes).toContain('trader')
      expect(archetypes).toContain('degen')
    })

    test('skips archetypes with insufficient trajectories', async () => {
      const jsonl = createMockTrajectoryJSONL([
        {
          trajectoryId: 't1',
          agentId: 'a1',
          archetype: 'trader',
          totalReward: 0.5,
        },
        {
          trajectoryId: 't2',
          agentId: 'a2',
          archetype: 'trader',
          totalReward: 0.7,
        },
        {
          trajectoryId: 't3',
          agentId: 'a3',
          archetype: 'lonely',
          totalReward: 0.3,
        }, // Only 1
      ])
      const compressed = createCompressedBatch(jsonl)

      mockFetchResponses.set('/storage/download/', {
        ok: true,
        status: 200,
        body: compressed,
      })
      setupMockScoringResponses()
      mockFetchResponses.set('/api/v1/upload', {
        ok: true,
        status: 200,
        body: { cid: 'QmFiltered' },
      })

      const processor = createBatchProcessor({ minTrajectoriesForRuler: 2 })
      const datasets = await processor.processBatches(['QmTest'], 'test-app')

      // Should only create dataset for trader (has 2), not lonely (has 1)
      expect(datasets.length).toBe(1)
      expect(datasets[0].archetype).toBe('trader')
    })

    // TODO: Fix mock response alignment - scoring service returns different IDs than test data
    test.skip('handles default archetype for null/undefined', async () => {
      const jsonl = [
        '{"_type":"header","batchId":"b1","appName":"test","trajectoryCount":2,"timestamp":"2024-01-01"}',
        '{"_type":"trajectory","id":"trajectory-1","trajectoryId":"trajectory-1","agentId":"a1","appName":"test","startTime":"2024-01-01","endTime":"2024-01-01","durationMs":1000,"windowId":"w","scenarioId":"s","steps":[{"stepNumber":0,"timestamp":1704067200000}],"rewardComponents":[],"metrics":{},"metadata":{},"totalReward":0.5}',
        '{"_type":"trajectory","id":"trajectory-2","trajectoryId":"trajectory-2","agentId":"a2","archetype":null,"appName":"test","startTime":"2024-01-01","endTime":"2024-01-01","durationMs":1000,"windowId":"w","scenarioId":"s","steps":[{"stepNumber":0,"timestamp":1704067200000}],"rewardComponents":[],"metrics":{},"metadata":{},"totalReward":0.6}',
      ].join('\n')
      const compressed = createCompressedBatch(jsonl)

      mockFetchResponses.set('/storage/download/', {
        ok: true,
        status: 200,
        body: compressed,
      })
      setupMockScoringResponses()
      mockFetchResponses.set('/api/v1/upload', {
        ok: true,
        status: 200,
        body: { cid: 'QmDefault' },
      })

      const processor = createBatchProcessor({ minTrajectoriesForRuler: 2 })
      const datasets = await processor.processBatches(['QmNull'], 'test-app')

      expect(datasets.length).toBe(1)
      expect(datasets[0].archetype).toBe('default')
    })
  })

  describe('Score Statistics', () => {
    test('calculates correct score distribution', async () => {
      const jsonl = createMockTrajectoryJSONL([
        {
          trajectoryId: 't1',
          agentId: 'a1',
          archetype: 'trader',
          totalReward: 0.2,
        },
        {
          trajectoryId: 't2',
          agentId: 'a2',
          archetype: 'trader',
          totalReward: 0.4,
        },
        {
          trajectoryId: 't3',
          agentId: 'a3',
          archetype: 'trader',
          totalReward: 0.6,
        },
        {
          trajectoryId: 't4',
          agentId: 'a4',
          archetype: 'trader',
          totalReward: 0.8,
        },
      ])
      const compressed = createCompressedBatch(jsonl)

      const origFetch = globalThis.fetch
      globalThis.fetch = async (
        url: string | URL | Request,
        _options?: RequestInit,
      ) => {
        const urlString = url.toString()

        if (urlString.includes('/storage/download/')) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => compressed,
          } as Response
        }

        if (urlString.includes('/v1/chat/completions')) {
          // Return RULER format with 4 trajectory scores
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      scores: [
                        {
                          trajectory_id: 'trajectory-1',
                          explanation: 'Score 1',
                          score: 0.3,
                        },
                        {
                          trajectory_id: 'trajectory-2',
                          explanation: 'Score 2',
                          score: 0.5,
                        },
                        {
                          trajectory_id: 'trajectory-3',
                          explanation: 'Score 3',
                          score: 0.7,
                        },
                        {
                          trajectory_id: 'trajectory-4',
                          explanation: 'Score 4',
                          score: 0.9,
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
          } as Response
        }

        if (urlString.includes('/api/v1/upload')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ cid: 'QmScored' }),
          } as Response
        }

        throw new Error(`Unexpected URL: ${urlString}`)
      }

      const processor = createBatchProcessor({ minTrajectoriesForRuler: 4 })
      const datasets = await processor.processBatches(['QmStats'], 'test-app')

      globalThis.fetch = origFetch

      expect(datasets.length).toBe(1)
      const dist = datasets[0].scoreDistribution

      expect(dist.min).toBeCloseTo(0.3, 1)
      expect(dist.max).toBeCloseTo(0.9, 1)
      // Median uses floor(n/2) index, so for [0.3, 0.5, 0.7, 0.9] it's index 2 = 0.7
      expect(dist.median).toBeCloseTo(0.7, 1)
    })
  })

  describe('Dataset Upload', () => {
    test('uploads dataset to Arweave', async () => {
      const jsonl = createMockTrajectoryJSONL([
        {
          trajectoryId: 't1',
          agentId: 'a1',
          archetype: 'trader',
          totalReward: 0.5,
        },
        {
          trajectoryId: 't2',
          agentId: 'a2',
          archetype: 'trader',
          totalReward: 0.7,
        },
      ])
      const compressed = createCompressedBatch(jsonl)

      let uploadedProvider: string | null = null
      const origFetch = globalThis.fetch
      globalThis.fetch = async (
        url: string | URL | Request,
        options?: RequestInit,
      ) => {
        const urlString = url.toString()

        if (urlString.includes('/storage/download/')) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => compressed,
          } as Response
        }

        if (urlString.includes('/v1/chat/completions')) {
          // Return RULER format
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      scores: [
                        {
                          trajectory_id: 'trajectory-1',
                          explanation: 'Good',
                          score: 0.5,
                        },
                        {
                          trajectory_id: 'trajectory-2',
                          explanation: 'Better',
                          score: 0.7,
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
          } as Response
        }

        if (urlString.includes('/api/v1/upload')) {
          const body = options?.body as FormData
          if (body instanceof FormData) {
            uploadedProvider = body.get('provider') as string
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ cid: 'QmArweave123' }),
          } as Response
        }

        throw new Error(`Unexpected: ${urlString}`)
      }

      const processor = createBatchProcessor({ minTrajectoriesForRuler: 2 })
      const datasets = await processor.processBatches(['QmTest'], 'test-app')

      globalThis.fetch = origFetch

      expect(uploadedProvider).toBe('arweave')
      expect(datasets[0].storageProvider).toBe('arweave')
      expect(datasets[0].permanentCid).toBe('QmArweave123')
    })

    test('handles upload failure', async () => {
      const jsonl = createMockTrajectoryJSONL([
        {
          trajectoryId: 't1',
          agentId: 'a1',
          archetype: 'trader',
          totalReward: 0.5,
        },
        {
          trajectoryId: 't2',
          agentId: 'a2',
          archetype: 'trader',
          totalReward: 0.7,
        },
      ])
      const compressed = createCompressedBatch(jsonl)

      mockFetchResponses.set('/storage/download/', {
        ok: true,
        status: 200,
        body: compressed,
      })
      setupMockScoringResponses()
      mockFetchResponses.set('/api/v1/upload', {
        ok: false,
        status: 500,
        body: 'Upload failed',
      })

      const processor = createBatchProcessor({ minTrajectoriesForRuler: 2 })

      await expect(
        processor.processBatches(['QmTest'], 'test-app'),
      ).rejects.toThrow('Arweave upload failed')
    })
  })

  describe('Callback Integration', () => {
    test('calls onDatasetCreated for each dataset', async () => {
      const jsonl = createMockTrajectoryJSONL([
        {
          trajectoryId: 't1',
          agentId: 'a1',
          archetype: 'trader',
          totalReward: 0.5,
        },
        {
          trajectoryId: 't2',
          agentId: 'a2',
          archetype: 'trader',
          totalReward: 0.7,
        },
      ])
      const compressed = createCompressedBatch(jsonl)

      mockFetchResponses.set('/storage/download/', {
        ok: true,
        status: 200,
        body: compressed,
      })
      setupMockScoringResponses()
      mockFetchResponses.set('/api/v1/upload', {
        ok: true,
        status: 200,
        body: { cid: 'QmCallback' },
      })

      const createdDatasets: DatasetReference[] = []
      const processor = createBatchProcessor({
        minTrajectoriesForRuler: 2,
        onDatasetCreated: async (dataset) => {
          createdDatasets.push(dataset)
        },
      })

      await processor.processBatches(['QmTest'], 'test-app')

      expect(createdDatasets).toHaveLength(1)
      expect(createdDatasets[0].permanentCid).toBe('QmCallback')
    })
  })

  describe('Multiple Batch Processing', () => {
    test('merges trajectories from multiple batches', async () => {
      const jsonl1 = createMockTrajectoryJSONL([
        {
          trajectoryId: 't1',
          agentId: 'a1',
          archetype: 'trader',
          totalReward: 0.5,
        },
      ])
      const jsonl2 = createMockTrajectoryJSONL([
        {
          trajectoryId: 't2',
          agentId: 'a2',
          archetype: 'trader',
          totalReward: 0.7,
        },
      ])

      const compressed1 = createCompressedBatch(jsonl1)
      const compressed2 = createCompressedBatch(jsonl2)

      let callIndex = 0
      const origFetch = globalThis.fetch
      globalThis.fetch = async (
        url: string | URL | Request,
        _options?: RequestInit,
      ) => {
        const urlString = url.toString()

        if (urlString.includes('/storage/download/')) {
          const batch = callIndex === 0 ? compressed1 : compressed2
          callIndex++
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => batch,
          } as Response
        }

        if (urlString.includes('/v1/chat/completions')) {
          // Return RULER format for 2 merged trajectories
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      scores: [
                        {
                          trajectory_id: 'trajectory-1',
                          explanation: 'Good',
                          score: 0.5,
                        },
                        {
                          trajectory_id: 'trajectory-2',
                          explanation: 'Better',
                          score: 0.7,
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
          } as Response
        }

        if (urlString.includes('/api/v1/upload')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ cid: 'QmMerged' }),
          } as Response
        }

        throw new Error(`Unexpected: ${urlString}`)
      }

      const processor = createBatchProcessor({ minTrajectoriesForRuler: 2 })
      const datasets = await processor.processBatches(
        ['QmBatch1', 'QmBatch2'],
        'test-app',
      )

      globalThis.fetch = origFetch

      expect(datasets).toHaveLength(1)
      expect(datasets[0].trajectoryCount).toBe(2)
    })
  })

  describe('Empty Results', () => {
    // TODO: Fix mock ArrayBuffer handling for gzip decompression
    test.skip('returns empty array when no trajectories', async () => {
      const jsonl = createMockTrajectoryJSONL([])
      const compressed = createCompressedBatch(jsonl)

      mockFetchResponses.set('/storage/download/', {
        ok: true,
        status: 200,
        body: compressed,
      })

      const processor = createBatchProcessor()

      // Should throw because trajectoryCount must be positive
      await expect(
        processor.processBatches(['QmEmpty'], 'test-app'),
      ).rejects.toThrow('Invalid batch: missing header')
    })

    test('throws when scoring returns no matching trajectory IDs', async () => {
      const jsonl = createMockTrajectoryJSONL([
        {
          trajectoryId: 't1',
          agentId: 'a1',
          archetype: 'trader',
          totalReward: 0.5,
        },
        {
          trajectoryId: 't2',
          agentId: 'a2',
          archetype: 'trader',
          totalReward: 0.7,
        },
      ])
      const compressed = createCompressedBatch(jsonl)

      mockFetchResponses.set('/storage/download/', {
        ok: true,
        status: 200,
        body: compressed,
      })
      // Return RULER format with empty scores - fail-fast when no matching IDs
      mockFetchResponses.set('/v1/chat/completions', {
        ok: true,
        status: 200,
        body: {
          choices: [
            {
              message: {
                content: JSON.stringify({ scores: [] }),
              },
            },
          ],
        },
      })

      const processor = createBatchProcessor({ minTrajectoriesForRuler: 2 })

      await expect(
        processor.processBatches(['QmNoScores'], 'test-app'),
      ).rejects.toThrow('Missing score for trajectory-1')
    })
  })
})

describe('downloadScoredDataset', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('downloads and parses scored dataset', async () => {
    const jsonlContent = [
      '{"_type":"header","datasetId":"ds1","appName":"test","archetype":"trader","trajectoryCount":1,"rulerModelId":"model1","timestamp":"2024-01-01"}',
      '{"_type":"scored_trajectory","trajectoryId":"t1","agentId":"a1","archetype":"trader","score":0.8,"reasoning":"Good","steps":[],"metrics":{"totalReward":0.8,"episodeLength":10,"actionSuccessRate":0.9}}',
    ].join('\n')
    const compressed = gzipSync(Buffer.from(jsonlContent))

    // Don't call setupMockFetch - use direct fetch override
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          compressed.buffer.slice(
            compressed.byteOffset,
            compressed.byteOffset + compressed.byteLength,
          ),
      }) as Response

    const result = await downloadScoredDataset('QmDataset', 'http://test')

    expect(result.header.datasetId).toBe('ds1')
    expect(result.header.archetype).toBe('trader')
    expect(result.trajectories).toHaveLength(1)
    expect(result.trajectories[0].score).toBe(0.8)
  })

  test('throws on missing header', async () => {
    const jsonlContent =
      '{"_type":"scored_trajectory","trajectoryId":"t1","score":0.5}'
    const compressed = gzipSync(Buffer.from(jsonlContent))

    // Don't call setupMockFetch - use direct fetch override
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          compressed.buffer.slice(
            compressed.byteOffset,
            compressed.byteOffset + compressed.byteLength,
          ),
      }) as Response

    await expect(
      downloadScoredDataset('QmNoHeader', 'http://test'),
    ).rejects.toThrow('Invalid dataset: missing header')
  })
})
