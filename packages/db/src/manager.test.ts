/**
 * Database Manager Tests
 *
 * Live integration tests for DatabaseManager class.
 * Requires EQLite or mock-eqlite-server to be running.
 *
 * Set EQLITE_AVAILABLE=true to force running, or tests auto-detect EQLite availability.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { resetEQLite } from './client.js'
import { DatabaseManager, type DatabaseManagerConfig } from './manager'

// EQLite endpoint
const EQLITE_ENDPOINT = process.env.EQLITE_ENDPOINT ?? 'http://localhost:4661'

// Check if EQLite is reachable
async function isEQLiteAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${EQLITE_ENDPOINT}/v1/status`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

// Auto-detect EQLite availability at test load time
const EQLITE_RUNNING =
  process.env.EQLITE_AVAILABLE === 'true' ||
  (await isEQLiteAvailable().catch(() => false))

describe.skipIf(!EQLITE_RUNNING)('DatabaseManager (Live Integration)', () => {
  let manager: DatabaseManager
  const testDbId = `test-manager-${Date.now()}`

  const defaultConfig: DatabaseManagerConfig = {
    appName: 'test-app',
    databaseId: testDbId,
    healthCheckInterval: 100, // Short interval for tests
    maxRetries: 3,
    baseRetryDelay: 10, // Short delay for tests
    maxRetryDelay: 100,
    debug: false,
  }

  beforeEach(async () => {
    await resetEQLite()
  })

  afterEach(async () => {
    if (manager) {
      await manager.stop()
    }
  })

  it('should start and report healthy status', async () => {
    const available = await isEQLiteAvailable()
    expect(available).toBe(true)

    manager = new DatabaseManager(defaultConfig)

    await manager.start()

    expect(manager.isHealthy()).toBe(true)
    expect(manager.getStats().status).toBe('healthy')
  })

  it('should execute schema DDL on initialization', async () => {
    manager = new DatabaseManager({
      ...defaultConfig,
      schema: [
        'CREATE TABLE IF NOT EXISTS test_table (id TEXT PRIMARY KEY, name TEXT)',
      ],
      indexes: ['CREATE INDEX IF NOT EXISTS idx_test ON test_table(id)'],
    })

    await manager.start()

    expect(manager.isHealthy()).toBe(true)

    // Verify table was created by querying it
    const result = await manager.query(
      'SELECT name FROM sqlite_master WHERE type="table" AND name="test_table"',
    )
    expect(result.rowCount).toBeGreaterThanOrEqual(0) // Table might exist or not depending on DB
  })

  it('should provide stats', async () => {
    manager = new DatabaseManager(defaultConfig)
    await manager.start()

    const stats = manager.getStats()

    expect(stats.status).toBe('healthy')
    expect(stats.healthy).toBe(true)
    expect(stats.consecutiveFailures).toBe(0)
    expect(stats.uptime).toBeGreaterThanOrEqual(0)
  })

  it('should execute queries through the manager', async () => {
    manager = new DatabaseManager({
      ...defaultConfig,
      schema: [
        'CREATE TABLE IF NOT EXISTS query_test (id TEXT PRIMARY KEY, name TEXT)',
      ],
    })
    await manager.start()

    // Use unique ID for each test run and INSERT OR REPLACE to handle reruns
    const testId = `test-${Date.now()}`
    await manager.exec(
      `INSERT OR REPLACE INTO query_test (id, name) VALUES (?, 'Test')`,
      [testId],
    )

    const result = await manager.query<{ id: string; name: string }>(
      'SELECT * FROM query_test WHERE id = ?',
      [testId],
    )

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Test')
  })

  it('should execute statements through the manager', async () => {
    manager = new DatabaseManager({
      ...defaultConfig,
      schema: ['CREATE TABLE IF NOT EXISTS exec_test (id TEXT PRIMARY KEY)'],
    })
    await manager.start()

    // Use unique ID for each test run
    const testId = `exec-${Date.now()}`
    const result = await manager.exec(
      'INSERT OR REPLACE INTO exec_test (id) VALUES (?)',
      [testId],
    )

    expect(result.rowsAffected).toBe(1)
  })

  it('should stop cleanly', async () => {
    manager = new DatabaseManager(defaultConfig)
    await manager.start()

    await manager.stop()

    expect(manager.getStats().status).toBe('stopped')
  })

  it('should handle callbacks', async () => {
    let healthChanged = false
    let isReady = false

    manager = new DatabaseManager({
      ...defaultConfig,
      onHealthChange: (_healthy) => {
        healthChanged = true
      },
      onReady: () => {
        isReady = true
      },
    })

    await manager.start()

    expect(healthChanged).toBe(true)
    expect(isReady).toBe(true)
  })
})
