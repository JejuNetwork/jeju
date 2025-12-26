/**
 * TrainingCronOrchestrator Tests
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import {
  getTrainingCronOrchestrator,
  resetTrainingCronOrchestrator,
  TrainingCronOrchestrator,
  type AppCronTrigger,
} from '../api/training/cron-orchestrator'

// Test Fixtures

function createTestTrigger(overrides: Partial<AppCronTrigger> = {}): AppCronTrigger {
  return {
    triggerId: `trigger-${Math.random().toString(36).slice(2)}`,
    appName: 'test-app',
    cronName: 'test-cron',
    schedule: '*/5 * * * *', // Every 5 minutes
    endpoint: 'http://localhost:9999/test',
    timeoutMs: 5000,
    enabled: true,
    ...overrides,
  }
}

// Mock fetch
let mockFetchResponses: Array<{
  ok: boolean
  status: number
  body: Record<string, unknown> | string
  delay?: number
}> = []
let fetchCalls: Array<{ url: string; method: string; headers: Record<string, string> }> = []

const originalFetch = globalThis.fetch
function setupMockFetch() {
  fetchCalls = []
  globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
    const urlString = url.toString()
    const method = options?.method ?? 'GET'
    const headers = options?.headers as Record<string, string> ?? {}
    
    fetchCalls.push({ url: urlString, method, headers })

    const mockResponse = mockFetchResponses.shift()
    if (!mockResponse) {
      throw new Error(`No mock response for fetch: ${urlString}`)
    }

    // Simulate delay if specified
    if (mockResponse.delay) {
      await new Promise((resolve) => setTimeout(resolve, mockResponse.delay))
    }

    return {
      ok: mockResponse.ok,
      status: mockResponse.status,
      text: async () =>
        typeof mockResponse.body === 'string'
          ? mockResponse.body
          : JSON.stringify(mockResponse.body),
      json: async () => mockResponse.body,
    } as Response
  }
}

function restoreFetch() {
  globalThis.fetch = originalFetch
}

// Test Suite

describe('TrainingCronOrchestrator', () => {
  let orchestrator: TrainingCronOrchestrator

  beforeEach(() => {
    mockFetchResponses = []
    fetchCalls = []
    setupMockFetch()
    orchestrator = new TrainingCronOrchestrator()
  })

  afterEach(() => {
    restoreFetch()
    orchestrator.stop()
    resetTrainingCronOrchestrator()
  })

  describe('Trigger Registration', () => {
    test('registers a new trigger', () => {
      const trigger = createTestTrigger({ triggerId: 'new-trigger' })
      orchestrator.registerTrigger(trigger)

      const status = orchestrator.getTriggerStatus('new-trigger')
      expect(status).not.toBeNull()
      expect(status?.trigger.triggerId).toBe('new-trigger')
      expect(status?.trigger.appName).toBe('test-app')
    })

    test('replaces existing trigger with same id', () => {
      const trigger1 = createTestTrigger({
        triggerId: 'replace-me',
        cronName: 'original',
      })
      const trigger2 = createTestTrigger({
        triggerId: 'replace-me',
        cronName: 'replacement',
      })

      orchestrator.registerTrigger(trigger1)
      orchestrator.registerTrigger(trigger2)

      const status = orchestrator.getTriggerStatus('replace-me')
      expect(status?.trigger.cronName).toBe('replacement')
    })

    test('registers multiple triggers', () => {
      orchestrator.registerTrigger(createTestTrigger({ triggerId: 't1' }))
      orchestrator.registerTrigger(createTestTrigger({ triggerId: 't2' }))
      orchestrator.registerTrigger(createTestTrigger({ triggerId: 't3' }))

      const triggers = orchestrator.listTriggers()
      expect(triggers).toHaveLength(3)
    })

    test('registers triggers from manifest', () => {
      orchestrator.registerFromManifest(
        'test-app',
        {
          cron: [
            { name: 'job1', schedule: '*/1 * * * *', endpoint: '/api/job1' },
            { name: 'job2', schedule: '*/2 * * * *', endpoint: '/api/job2', timeout: 10000 },
          ],
        },
        'http://localhost:3000',
        'secret-token',
      )

      const triggers = orchestrator.listTriggers()
      expect(triggers).toHaveLength(2)

      const job1Status = orchestrator.getTriggerStatus('test-app-job1')
      expect(job1Status?.trigger.endpoint).toBe('http://localhost:3000/api/job1')
      expect(job1Status?.trigger.authToken).toBe('secret-token')

      const job2Status = orchestrator.getTriggerStatus('test-app-job2')
      expect(job2Status?.trigger.timeoutMs).toBe(10000)
    })

    test('skips registration with empty manifest', () => {
      orchestrator.registerFromManifest('empty-app', {}, 'http://localhost')
      expect(orchestrator.listTriggers()).toHaveLength(0)
    })
  })

  describe('Trigger Execution', () => {
    test('executes trigger successfully', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { success: true, count: 42 },
      })

      const trigger = createTestTrigger({ endpoint: 'http://test/api/job' })
      const result = await orchestrator.executeTrigger(trigger)

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.response).toEqual({ success: true, count: 42 })
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0].method).toBe('POST')
    })

    test('includes auth header when token provided', async () => {
      mockFetchResponses.push({ ok: true, status: 200, body: {} })

      const trigger = createTestTrigger({ authToken: 'my-secret' })
      await orchestrator.executeTrigger(trigger)

      expect(fetchCalls[0].headers.Authorization).toBe('Bearer my-secret')
    })

    test('handles HTTP error response', async () => {
      mockFetchResponses.push({
        ok: false,
        status: 500,
        body: 'Internal Server Error',
      })

      const trigger = createTestTrigger()
      const result = await orchestrator.executeTrigger(trigger)

      expect(result.success).toBe(false)
      expect(result.error).toContain('HTTP 500')
      expect(result.error).toContain('Internal Server Error')
    })

    test('handles JSON parse error gracefully', async () => {
      // Response is ok but body isn't valid JSON
      const origFetch = globalThis.fetch
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => 'not valid json {',
      }) as Response

      const trigger = createTestTrigger()
      const result = await orchestrator.executeTrigger(trigger)

      globalThis.fetch = origFetch

      expect(result.success).toBe(true)
      expect(result.response?._parseError).toBe(true)
    })

    test('handles empty response body', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => '',
      }) as Response

      const trigger = createTestTrigger()
      const result = await orchestrator.executeTrigger(trigger)

      globalThis.fetch = origFetch

      expect(result.success).toBe(true)
      expect(result.response).toEqual({})
    })

    test('handles network error', async () => {
      const origFetch = globalThis.fetch
      globalThis.fetch = async () => {
        throw new Error('Connection refused')
      }

      const trigger = createTestTrigger()
      const result = await orchestrator.executeTrigger(trigger)

      globalThis.fetch = origFetch

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
      expect(result.error).toContain('Connection refused')
    })

    test('handles timeout via AbortController', async () => {
      // Create a fetch that hangs longer than timeout
      const origFetch = globalThis.fetch
      globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
        const signal = options?.signal
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            resolve({ ok: true, status: 200, text: async () => '{}' } as Response)
          }, 10000)

          signal?.addEventListener('abort', () => {
            clearTimeout(timeout)
            const error = new Error('The operation was aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
      }

      const trigger = createTestTrigger({ timeoutMs: 100 })
      const result = await orchestrator.executeTrigger(trigger)

      globalThis.fetch = origFetch

      expect(result.success).toBe(false)
      expect(result.error).toContain('Timeout after 100ms')
    })
  })

  describe('Pending Batch Tracking', () => {
    test('tracks batches from trigger responses', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: {
          success: true,
          storageCid: 'QmTestBatch',
          trajectoryCount: 50,
        },
      })

      const trigger = createTestTrigger()
      await orchestrator.executeTrigger(trigger)

      const info = orchestrator.getPendingBatchesInfo()
      expect(info.count).toBe(1)
      expect(info.totalTrajectories).toBe(50)
      expect(info.byApp['test-app']).toBe(1)
    })

    test('accumulates multiple pending batches', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { storageCid: 'QmBatch1', trajectoryCount: 10 },
      })
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { storageCid: 'QmBatch2', trajectoryCount: 20 },
      })

      await orchestrator.executeTrigger(createTestTrigger({ appName: 'app1' }))
      await orchestrator.executeTrigger(createTestTrigger({ appName: 'app2' }))

      const info = orchestrator.getPendingBatchesInfo()
      expect(info.count).toBe(2)
      expect(info.totalTrajectories).toBe(30)
      expect(info.byApp['app1']).toBe(1)
      expect(info.byApp['app2']).toBe(1)
    })

    test('addPendingBatch manually adds batch', () => {
      orchestrator.addPendingBatch('manual-app', 'QmManual', 100)

      const info = orchestrator.getPendingBatchesInfo()
      expect(info.count).toBe(1)
      expect(info.totalTrajectories).toBe(100)
    })

    test('ignores responses without batch info', async () => {
      mockFetchResponses.push({
        ok: true,
        status: 200,
        body: { success: true },
      })

      await orchestrator.executeTrigger(createTestTrigger())

      const info = orchestrator.getPendingBatchesInfo()
      expect(info.count).toBe(0)
    })
  })

  describe('Execution History', () => {
    test('records successful executions', async () => {
      mockFetchResponses.push({ ok: true, status: 200, body: {} })

      const trigger = createTestTrigger({ appName: 'history-app' })
      await orchestrator.executeTrigger(trigger)

      const history = orchestrator.getExecutionHistory()
      expect(history).toHaveLength(1)
      expect(history[0].success).toBe(true)
      expect(history[0].appName).toBe('history-app')
    })

    test('records failed executions', async () => {
      mockFetchResponses.push({ ok: false, status: 500, body: 'Error' })

      const trigger = createTestTrigger()
      await orchestrator.executeTrigger(trigger)

      const history = orchestrator.getExecutionHistory()
      expect(history).toHaveLength(1)
      expect(history[0].success).toBe(false)
      expect(history[0].error).toBeDefined()
    })

    test('filters history by app name', async () => {
      mockFetchResponses.push({ ok: true, status: 200, body: {} })
      mockFetchResponses.push({ ok: true, status: 200, body: {} })
      mockFetchResponses.push({ ok: true, status: 200, body: {} })

      await orchestrator.executeTrigger(createTestTrigger({ appName: 'app-a' }))
      await orchestrator.executeTrigger(createTestTrigger({ appName: 'app-b' }))
      await orchestrator.executeTrigger(createTestTrigger({ appName: 'app-a' }))

      const allHistory = orchestrator.getExecutionHistory()
      expect(allHistory).toHaveLength(3)

      const appAHistory = orchestrator.getExecutionHistory('app-a')
      expect(appAHistory).toHaveLength(2)

      const appBHistory = orchestrator.getExecutionHistory('app-b')
      expect(appBHistory).toHaveLength(1)
    })

    test('limits history size', async () => {
      // Push many mock responses
      for (let i = 0; i < 120; i++) {
        mockFetchResponses.push({ ok: true, status: 200, body: {} })
      }

      // Execute many triggers
      for (let i = 0; i < 120; i++) {
        await orchestrator.executeTrigger(createTestTrigger())
      }

      const history = orchestrator.getExecutionHistory(undefined, 200)
      expect(history.length).toBeLessThanOrEqual(100) // MAX_HISTORY_SIZE
    })

    test('returns history sorted by most recent first', async () => {
      mockFetchResponses.push({ ok: true, status: 200, body: {} })
      mockFetchResponses.push({ ok: true, status: 200, body: {} })
      mockFetchResponses.push({ ok: true, status: 200, body: {} })

      await orchestrator.executeTrigger(createTestTrigger({ cronName: 'first' }))
      await new Promise((r) => setTimeout(r, 10))
      await orchestrator.executeTrigger(createTestTrigger({ cronName: 'second' }))
      await new Promise((r) => setTimeout(r, 10))
      await orchestrator.executeTrigger(createTestTrigger({ cronName: 'third' }))

      const history = orchestrator.getExecutionHistory()
      expect(history[0].cronName).toBe('third')
      expect(history[1].cronName).toBe('second')
      expect(history[2].cronName).toBe('first')
    })
  })

  describe('Enable/Disable Triggers', () => {
    test('disabling trigger stops its cron', () => {
      const trigger = createTestTrigger({ triggerId: 'disable-me', enabled: true })
      orchestrator.registerTrigger(trigger)

      let status = orchestrator.getTriggerStatus('disable-me')
      expect(status?.trigger.enabled).toBe(true)

      orchestrator.disableTrigger('disable-me')

      status = orchestrator.getTriggerStatus('disable-me')
      expect(status?.trigger.enabled).toBe(false)
    })

    test('enabling trigger starts its cron', () => {
      const trigger = createTestTrigger({ triggerId: 'enable-me', enabled: false })
      orchestrator.registerTrigger(trigger)

      let status = orchestrator.getTriggerStatus('enable-me')
      expect(status?.trigger.enabled).toBe(false)

      orchestrator.enableTrigger('enable-me')

      status = orchestrator.getTriggerStatus('enable-me')
      expect(status?.trigger.enabled).toBe(true)
    })

    test('disabling non-existent trigger does not throw', () => {
      expect(() => orchestrator.disableTrigger('does-not-exist')).not.toThrow()
    })
  })

  describe('Trigger Status', () => {
    test('returns null for unknown trigger', () => {
      const status = orchestrator.getTriggerStatus('unknown')
      expect(status).toBeNull()
    })

    test('includes next run time for enabled trigger', () => {
      const trigger = createTestTrigger({
        triggerId: 'scheduled',
        enabled: true,
        schedule: '*/1 * * * *',
      })
      orchestrator.registerTrigger(trigger)
      orchestrator.start()

      const status = orchestrator.getTriggerStatus('scheduled')
      expect(status?.nextRun).not.toBeNull()
      expect(status?.nextRun?.getTime()).toBeGreaterThan(Date.now())
    })

    test('returns null next run for disabled trigger', () => {
      const trigger = createTestTrigger({ triggerId: 'disabled', enabled: false })
      orchestrator.registerTrigger(trigger)

      const status = orchestrator.getTriggerStatus('disabled')
      expect(status?.nextRun).toBeNull()
    })

    test('includes last execution in status', async () => {
      mockFetchResponses.push({ ok: true, status: 200, body: { result: 'test' } })

      const trigger = createTestTrigger({ triggerId: 'with-history' })
      orchestrator.registerTrigger(trigger)
      await orchestrator.executeTrigger(trigger)

      const status = orchestrator.getTriggerStatus('with-history')
      expect(status?.lastExecution).not.toBeNull()
      expect(status?.lastExecution?.success).toBe(true)
    })
  })

  describe('Start/Stop', () => {
    test('start enables all triggers', () => {
      orchestrator.registerTrigger(createTestTrigger({ triggerId: 't1', enabled: true }))
      orchestrator.registerTrigger(createTestTrigger({ triggerId: 't2', enabled: true }))
      orchestrator.registerTrigger(createTestTrigger({ triggerId: 't3', enabled: false }))

      orchestrator.start()

      // Enabled triggers should have next run times
      expect(orchestrator.getTriggerStatus('t1')?.nextRun).not.toBeNull()
      expect(orchestrator.getTriggerStatus('t2')?.nextRun).not.toBeNull()
      // Disabled trigger should not be started
      expect(orchestrator.getTriggerStatus('t3')?.nextRun).toBeNull()
    })

    test('stop clears all cron instances', () => {
      orchestrator.registerTrigger(createTestTrigger({ triggerId: 't1', enabled: true }))
      orchestrator.registerTrigger(createTestTrigger({ triggerId: 't2', enabled: true }))

      orchestrator.start()
      expect(orchestrator.getTriggerStatus('t1')?.nextRun).not.toBeNull()

      orchestrator.stop()
      expect(orchestrator.getTriggerStatus('t1')?.nextRun).toBeNull()
      expect(orchestrator.getTriggerStatus('t2')?.nextRun).toBeNull()
    })

    test('stop is idempotent', () => {
      orchestrator.start()
      orchestrator.stop()
      expect(() => orchestrator.stop()).not.toThrow()
    })
  })

  describe('Singleton Pattern', () => {
    test('getTrainingCronOrchestrator returns singleton', () => {
      resetTrainingCronOrchestrator()
      const o1 = getTrainingCronOrchestrator()
      const o2 = getTrainingCronOrchestrator()
      expect(o1).toBe(o2)
    })

    test('resetTrainingCronOrchestrator clears singleton', () => {
      const o1 = getTrainingCronOrchestrator()
      o1.registerTrigger(createTestTrigger({ triggerId: 'before-reset' }))

      resetTrainingCronOrchestrator()

      const o2 = getTrainingCronOrchestrator()
      expect(o2).not.toBe(o1)
      expect(o2.getTriggerStatus('before-reset')).toBeNull()
    })
  })

  describe('List Triggers', () => {
    test('returns all registered triggers with next run', () => {
      orchestrator.registerTrigger(createTestTrigger({ triggerId: 't1', enabled: true }))
      orchestrator.registerTrigger(createTestTrigger({ triggerId: 't2', enabled: false }))
      orchestrator.start()

      const list = orchestrator.listTriggers()
      expect(list).toHaveLength(2)

      const t1 = list.find((t) => t.trigger.triggerId === 't1')
      const t2 = list.find((t) => t.trigger.triggerId === 't2')

      expect(t1?.nextRun).not.toBeNull()
      expect(t2?.nextRun).toBeNull()
    })
  })
})
