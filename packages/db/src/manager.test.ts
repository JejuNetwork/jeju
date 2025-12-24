/**
 * Database Manager Tests
 *
 * Note: These tests use module mocking which is isolated to this file.
 * The mock.module() call creates a scoped mock that doesn't affect other test files.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { DatabaseManager, type DatabaseManagerConfig } from './manager'

// Mock the CQL client module
const mockIsHealthy = mock(() => Promise.resolve(true))
const mockExec = mock(() =>
  Promise.resolve({
    rowsAffected: 0,
    txHash: '0x',
    blockHeight: 0,
    gasUsed: 0n,
  }),
)
const mockQuery = mock(() =>
  Promise.resolve({
    rows: [],
    rowCount: 0,
    columns: [],
    executionTime: 0,
    blockHeight: 0,
  }),
)
const mockClose = mock(() => Promise.resolve())
const mockGetCircuitState = mock(() => ({
  state: 'closed' as const,
  failures: 0,
}))

mock.module('./client.js', () => ({
  getCQL: () => ({
    isHealthy: mockIsHealthy,
    exec: mockExec,
    query: mockQuery,
    close: mockClose,
    getCircuitState: mockGetCircuitState,
  }),
  resetCQL: mock(() => {}),
}))

describe('DatabaseManager', () => {
  let manager: DatabaseManager

  const defaultConfig: DatabaseManagerConfig = {
    appName: 'test-app',
    databaseId: 'test-db',
    healthCheckInterval: 100, // Short interval for tests
    maxRetries: 3,
    baseRetryDelay: 10, // Short delay for tests
    maxRetryDelay: 100,
    debug: false,
  }

  beforeEach(() => {
    mockIsHealthy.mockClear()
    mockExec.mockClear()
    mockQuery.mockClear()
    mockClose.mockClear()
    mockIsHealthy.mockImplementation(() => Promise.resolve(true))
  })

  afterEach(async () => {
    if (manager) {
      await manager.stop()
    }
  })

  it('should start and report healthy status', async () => {
    manager = new DatabaseManager(defaultConfig)

    await manager.start()

    expect(manager.isHealthy()).toBe(true)
    expect(manager.getStats().status).toBe('healthy')
  })

  it('should execute schema DDL on initialization', async () => {
    manager = new DatabaseManager({
      ...defaultConfig,
      schema: ['CREATE TABLE IF NOT EXISTS test (id TEXT PRIMARY KEY)'],
      indexes: ['CREATE INDEX IF NOT EXISTS idx_test ON test(id)'],
    })

    await manager.start()

    expect(mockExec).toHaveBeenCalledTimes(2)
  })

  it('should report unhealthy when CQL is down', async () => {
    mockIsHealthy.mockImplementation(() => Promise.resolve(false))
    manager = new DatabaseManager(defaultConfig)

    await expect(manager.start()).rejects.toThrow('Database connection failed')
    expect(manager.isHealthy()).toBe(false)
  })

  it('should call onHealthChange callback', async () => {
    const onHealthChange = mock<(healthy: boolean, status: string) => void>(
      () => {},
    )

    manager = new DatabaseManager({
      ...defaultConfig,
      onHealthChange,
    })

    await manager.start()

    expect(onHealthChange).toHaveBeenCalled()
  })

  it('should call onReady callback', async () => {
    const onReady = mock(() => {})

    manager = new DatabaseManager({
      ...defaultConfig,
      onReady,
    })

    await manager.start()

    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('should throw when getting client if not healthy', async () => {
    mockIsHealthy.mockImplementation(() => Promise.resolve(false))
    manager = new DatabaseManager(defaultConfig)

    expect(() => manager.getClient()).toThrow('Database not available')
  })

  it('should provide stats', async () => {
    manager = new DatabaseManager(defaultConfig)
    await manager.start()

    const stats = manager.getStats()

    expect(stats.status).toBe('healthy')
    expect(stats.healthy).toBe(true)
    expect(stats.consecutiveFailures).toBe(0)
    expect(stats.totalReconnects).toBe(0)
    expect(stats.uptime).toBeGreaterThanOrEqual(0)
  })

  it('should execute queries through the manager', async () => {
    mockQuery.mockImplementation(() =>
      Promise.resolve({
        rows: [{ id: '1', name: 'Test' }],
        rowCount: 1,
        columns: [],
        executionTime: 5,
        blockHeight: 100,
      }),
    )

    manager = new DatabaseManager(defaultConfig)
    await manager.start()

    const result = await manager.query<{ id: string; name: string }>(
      'SELECT * FROM test',
    )

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Test')
  })

  it('should execute statements through the manager', async () => {
    mockExec.mockImplementation(() =>
      Promise.resolve({
        rowsAffected: 1,
        txHash: '0x123',
        blockHeight: 100,
        gasUsed: 1000n,
      }),
    )

    manager = new DatabaseManager(defaultConfig)
    await manager.start()

    const result = await manager.exec('INSERT INTO test (id) VALUES (?)', ['1'])

    expect(result.rowsAffected).toBe(1)
  })

  it('should stop cleanly', async () => {
    manager = new DatabaseManager(defaultConfig)
    await manager.start()

    await manager.stop()

    expect(manager.getStats().status).toBe('stopped')
    expect(mockClose).toHaveBeenCalled()
  })
})
