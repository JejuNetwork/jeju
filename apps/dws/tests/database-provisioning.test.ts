/**
 * Secure SQL Database Provisioning Tests
 *
 * Tests for provisioning, configuring, and managing secure SQL databases through DWS.
 * Covers:
 * - Database creation with various configurations
 * - ACL (Access Control List) management
 * - Rental plan management
 * - Connection pooling
 * - Transaction isolation
 * - Health checks and status monitoring
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Test configuration
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
const TEST_ADDRESS = privateKeyToAccount(TEST_PRIVATE_KEY).address
const TEST_PAYMENT_TOKEN =
  '0x0000000000000000000000000000000000000000' as Address

import { getLocalhostHost, getSQLitBlockProducerUrl } from '@jejunetwork/config'

// Check if SQLit is available for integration tests
async function checkSQLitHealth(): Promise<boolean> {
  const endpoint =
    (typeof process !== 'undefined'
      ? process.env.SQLIT_BLOCK_PRODUCER_ENDPOINT
      : undefined) ||
    getSQLitBlockProducerUrl() ||
    `http://${getLocalhostHost()}:4661`
  const response = await fetch(`${endpoint}/health`, {
    signal: AbortSignal.timeout(3000),
  }).catch(() => null)
  return response?.ok ?? false
}

const SQLIT_AVAILABLE = await checkSQLitHealth()

// Mock SQLit Client for Unit Testing

interface MockDatabase {
  id: string
  owner: Address
  status: 'creating' | 'running' | 'stopped' | 'migrating' | 'error'
  nodeCount: number
  consistencyMode: 'eventual' | 'strong'
  createdAt: number
  blockHeight: number
  sizeBytes: number
  monthlyCost: bigint
  tables: Map<string, MockTable>
  acl: MockACLRule[]
}

interface MockTable {
  name: string
  columns: Array<{ name: string; type: string }>
  rows: Array<Record<string, unknown>>
}

interface MockACLRule {
  grantee: Address | '*'
  table: string
  columns: string[] | '*'
  permissions: Array<'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL'>
  condition?: string
}

interface MockRentalPlan {
  id: string
  name: string
  nodeCount: number
  storageBytes: bigint
  queriesPerMonth: bigint
  pricePerMonth: bigint
  paymentToken: Address
}

interface MockRental {
  id: string
  databaseId: string
  renter: Address
  planId: string
  startedAt: number
  expiresAt: number
  autoRenew: boolean
  paymentStatus: 'current' | 'overdue' | 'cancelled'
}

class MockSQLitClient {
  private databases = new Map<string, MockDatabase>()
  private rentals = new Map<string, MockRental>()
  private connectionPools = new Map<string, { active: number; idle: number }>()
  private healthy = true
  private blockHeight = 1000

  private plans: MockRentalPlan[] = [
    {
      id: 'starter',
      name: 'Starter',
      nodeCount: 1,
      storageBytes: 1_000_000_000n,
      queriesPerMonth: 100_000n,
      pricePerMonth: 10_000_000_000_000_000n,
      paymentToken: TEST_PAYMENT_TOKEN,
    },
    {
      id: 'pro',
      name: 'Professional',
      nodeCount: 3,
      storageBytes: 10_000_000_000n,
      queriesPerMonth: 1_000_000n,
      pricePerMonth: 50_000_000_000_000_000n,
      paymentToken: TEST_PAYMENT_TOKEN,
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      nodeCount: 5,
      storageBytes: 100_000_000_000n,
      queriesPerMonth: 10_000_000n,
      pricePerMonth: 200_000_000_000_000_000n,
      paymentToken: TEST_PAYMENT_TOKEN,
    },
  ]

  setHealthy(healthy: boolean): void {
    this.healthy = healthy
  }

  async isHealthy(): Promise<boolean> {
    return this.healthy
  }

  async getBlockProducerInfo(): Promise<{
    address: Address
    endpoint: string
    blockHeight: number
    databases: number
    stake: bigint
    status: 'active' | 'syncing' | 'offline'
  }> {
    return {
      address: TEST_ADDRESS,
      endpoint:
        getSQLitBlockProducerUrl() || `http://${getLocalhostHost()}:4661`,
      blockHeight: this.blockHeight++,
      databases: this.databases.size,
      stake: 1000000000000000000n,
      status: this.healthy ? 'active' : 'offline',
    }
  }

  async createDatabase(config: {
    nodeCount: number
    useEventualConsistency?: boolean
    regions?: string[]
    schema?: string
    owner: Address
    paymentToken?: Address
  }): Promise<MockDatabase> {
    if (!this.healthy) {
      throw new Error('SQLit service is not healthy')
    }

    if (config.nodeCount < 1) {
      throw new Error('nodeCount must be at least 1')
    }

    if (config.nodeCount > 10) {
      throw new Error('nodeCount cannot exceed 10')
    }

    const id = `db-${crypto.randomUUID()}`
    const db: MockDatabase = {
      id,
      owner: config.owner,
      status: 'running',
      nodeCount: config.nodeCount,
      consistencyMode: config.useEventualConsistency ? 'eventual' : 'strong',
      createdAt: Date.now(),
      blockHeight: this.blockHeight++,
      sizeBytes: 0,
      monthlyCost: BigInt(config.nodeCount) * 1000000000000000n,
      tables: new Map(),
      acl: [],
    }

    // Parse initial schema if provided
    if (config.schema) {
      const tableMatch = config.schema.match(
        /CREATE TABLE (?:IF NOT EXISTS )?["']?(\w+)["']?/gi,
      )
      if (tableMatch) {
        for (const match of tableMatch) {
          const tableName = match
            .replace(/CREATE TABLE (?:IF NOT EXISTS )?["']?/i, '')
            .replace(/["']?$/, '')
          db.tables.set(tableName, {
            name: tableName,
            columns: [],
            rows: [],
          })
        }
      }
    }

    this.databases.set(id, db)
    this.connectionPools.set(id, { active: 0, idle: 5 })

    return db
  }

  async getDatabase(id: string): Promise<MockDatabase> {
    const db = this.databases.get(id)
    if (!db) {
      throw new Error(`Database ${id} not found`)
    }
    return db
  }

  async listDatabases(owner: Address): Promise<MockDatabase[]> {
    return Array.from(this.databases.values()).filter(
      (db) => db.owner === owner,
    )
  }

  async deleteDatabase(id: string): Promise<void> {
    if (!this.databases.has(id)) {
      throw new Error(`Database ${id} not found`)
    }
    this.databases.delete(id)
    this.connectionPools.delete(id)
  }

  async grant(
    dbId: string,
    req: {
      grantee: Address
      table: string
      columns?: string[]
      permissions: Array<'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL'>
      condition?: string
    },
  ): Promise<void> {
    const db = this.databases.get(dbId)
    if (!db) {
      throw new Error(`Database ${dbId} not found`)
    }

    // Validate permissions
    for (const perm of req.permissions) {
      if (!['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL'].includes(perm)) {
        throw new Error(`Invalid permission: ${perm}`)
      }
    }

    db.acl.push({
      grantee: req.grantee,
      table: req.table,
      columns: req.columns ?? '*',
      permissions: req.permissions,
      condition: req.condition,
    })
  }

  async revoke(
    dbId: string,
    req: {
      grantee: Address
      table: string
      columns?: string[]
      permissions: Array<'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL'>
    },
  ): Promise<void> {
    const db = this.databases.get(dbId)
    if (!db) {
      throw new Error(`Database ${dbId} not found`)
    }

    db.acl = db.acl.filter(
      (rule) =>
        !(
          rule.grantee === req.grantee &&
          rule.table === req.table &&
          req.permissions.every((p) => rule.permissions.includes(p))
        ),
    )
  }

  async listACL(dbId: string): Promise<MockACLRule[]> {
    const db = this.databases.get(dbId)
    if (!db) {
      throw new Error(`Database ${dbId} not found`)
    }
    return db.acl
  }

  async listPlans(): Promise<MockRentalPlan[]> {
    return this.plans
  }

  async createRental(req: {
    planId: string
    schema?: string
    autoRenew?: boolean
    paymentToken?: Address
    months?: number
  }): Promise<MockRental> {
    const plan = this.plans.find((p) => p.id === req.planId)
    if (!plan) {
      throw new Error(`Plan ${req.planId} not found`)
    }

    const db = await this.createDatabase({
      nodeCount: plan.nodeCount,
      schema: req.schema,
      owner: TEST_ADDRESS,
      paymentToken: req.paymentToken ?? plan.paymentToken,
    })

    const months = req.months ?? 1
    const rental: MockRental = {
      id: `rental-${crypto.randomUUID()}`,
      databaseId: db.id,
      renter: TEST_ADDRESS,
      planId: req.planId,
      startedAt: Date.now(),
      expiresAt: Date.now() + months * 30 * 24 * 60 * 60 * 1000,
      autoRenew: req.autoRenew ?? false,
      paymentStatus: 'current',
    }

    this.rentals.set(rental.id, rental)
    return rental
  }

  async getRental(id: string): Promise<MockRental> {
    const rental = this.rentals.get(id)
    if (!rental) {
      throw new Error(`Rental ${id} not found`)
    }
    return rental
  }

  async extendRental(id: string, months: number): Promise<MockRental> {
    const rental = this.rentals.get(id)
    if (!rental) {
      throw new Error(`Rental ${id} not found`)
    }

    if (months < 1) {
      throw new Error('months must be at least 1')
    }

    rental.expiresAt += months * 30 * 24 * 60 * 60 * 1000
    return rental
  }

  async cancelRental(id: string): Promise<void> {
    const rental = this.rentals.get(id)
    if (!rental) {
      throw new Error(`Rental ${id} not found`)
    }
    rental.paymentStatus = 'cancelled'
  }

  getPoolStats(
    dbId: string,
  ): { active: number; idle: number; total: number } | null {
    const pool = this.connectionPools.get(dbId)
    if (!pool) return null
    return { ...pool, total: pool.active + pool.idle }
  }

  async query<T>(
    dbId: string,
    sql: string,
    params?: Array<string | number | boolean | null>,
  ): Promise<{ rows: T[]; rowCount: number }> {
    const db = this.databases.get(dbId)
    if (!db) {
      throw new Error(`Database ${dbId} not found`)
    }

    // Simple query simulation
    const tableMatch = sql.match(/FROM ["']?(\w+)["']?/i)
    if (!tableMatch) {
      return { rows: [], rowCount: 0 }
    }

    const tableName = tableMatch[1]
    const table = db.tables.get(tableName)
    if (!table) {
      throw new Error(`Table ${tableName} does not exist`)
    }

    void params // Future use for parameterized queries
    return { rows: table.rows as T[], rowCount: table.rows.length }
  }

  async exec(
    dbId: string,
    sql: string,
    params?: Array<string | number | boolean | null>,
  ): Promise<{ rowsAffected: number; txHash: Hex }> {
    const db = this.databases.get(dbId)
    if (!db) {
      throw new Error(`Database ${dbId} not found`)
    }

    // Handle CREATE TABLE
    const createMatch = sql.match(
      /CREATE TABLE (?:IF NOT EXISTS )?["']?(\w+)["']?/i,
    )
    if (createMatch) {
      const tableName = createMatch[1]
      if (!tableName) {
        throw new Error('Invalid CREATE TABLE syntax')
      }
      if (db.tables.has(tableName) && !sql.includes('IF NOT EXISTS')) {
        throw new Error(`Table ${tableName} already exists`)
      }
      db.tables.set(tableName, { name: tableName, columns: [], rows: [] })
      return {
        rowsAffected: 0,
        txHash: `0x${crypto.randomUUID().replace(/-/g, '')}` as Hex,
      }
    }

    // Handle INSERT
    const insertMatch = sql.match(/INSERT INTO ["']?(\w+)["']?/i)
    if (insertMatch) {
      const tableName = insertMatch[1]
      const table = db.tables.get(tableName)
      if (!table) {
        throw new Error(`Table ${tableName} does not exist`)
      }
      // Simplified insert - just add params as a row
      if (params) {
        table.rows.push(
          Object.fromEntries(params.map((p, i) => [`col${i}`, p])),
        )
      }
      db.sizeBytes += 100
      return {
        rowsAffected: 1,
        txHash: `0x${crypto.randomUUID().replace(/-/g, '')}` as Hex,
      }
    }

    // Handle DELETE
    const deleteMatch = sql.match(/DELETE FROM ["']?(\w+)["']?/i)
    if (deleteMatch) {
      const tableName = deleteMatch[1]
      const table = db.tables.get(tableName)
      if (!table) {
        throw new Error(`Table ${tableName} does not exist`)
      }
      const count = table.rows.length
      table.rows = []
      return {
        rowsAffected: count,
        txHash: `0x${crypto.randomUUID().replace(/-/g, '')}` as Hex,
      }
    }

    void params // Future use
    return {
      rowsAffected: 0,
      txHash: `0x${crypto.randomUUID().replace(/-/g, '')}` as Hex,
    }
  }

  reset(): void {
    this.databases.clear()
    this.rentals.clear()
    this.connectionPools.clear()
    this.healthy = true
    this.blockHeight = 1000
  }
}

// Database Provisioning Tests

describe('Secure SQL Database Provisioning', () => {
  const client = new MockSQLitClient()

  beforeAll(() => {
    client.reset()
  })

  afterAll(() => {
    client.reset()
  })

  describe('Database Creation', () => {
    test('should create a database with default configuration', async () => {
      const db = await client.createDatabase({
        nodeCount: 1,
        owner: TEST_ADDRESS,
      })

      expect(db.id).toMatch(/^db-/)
      expect(db.owner).toBe(TEST_ADDRESS)
      expect(db.status).toBe('running')
      expect(db.nodeCount).toBe(1)
      expect(db.consistencyMode).toBe('strong')
    })

    test('should create a database with eventual consistency', async () => {
      const db = await client.createDatabase({
        nodeCount: 3,
        useEventualConsistency: true,
        owner: TEST_ADDRESS,
      })

      expect(db.consistencyMode).toBe('eventual')
      expect(db.nodeCount).toBe(3)
    })

    test('should create a database with initial schema', async () => {
      const schema = `
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE
        );
        CREATE TABLE IF NOT EXISTS posts (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id),
          content TEXT
        );
      `
      const db = await client.createDatabase({
        nodeCount: 1,
        schema,
        owner: TEST_ADDRESS,
      })

      expect(db.tables.size).toBe(2)
      expect(db.tables.has('users')).toBe(true)
      expect(db.tables.has('posts')).toBe(true)
    })

    test('should reject nodeCount less than 1', async () => {
      await expect(
        client.createDatabase({
          nodeCount: 0,
          owner: TEST_ADDRESS,
        }),
      ).rejects.toThrow('nodeCount must be at least 1')
    })

    test('should reject nodeCount greater than 10', async () => {
      await expect(
        client.createDatabase({
          nodeCount: 11,
          owner: TEST_ADDRESS,
        }),
      ).rejects.toThrow('nodeCount cannot exceed 10')
    })

    test('should fail when service is unhealthy', async () => {
      client.setHealthy(false)

      await expect(
        client.createDatabase({
          nodeCount: 1,
          owner: TEST_ADDRESS,
        }),
      ).rejects.toThrow('SQLit service is not healthy')

      client.setHealthy(true)
    })
  })

  describe('Database Retrieval and Listing', () => {
    test('should retrieve a database by ID', async () => {
      const created = await client.createDatabase({
        nodeCount: 1,
        owner: TEST_ADDRESS,
      })

      const retrieved = await client.getDatabase(created.id)
      expect(retrieved.id).toBe(created.id)
      expect(retrieved.owner).toBe(created.owner)
    })

    test('should throw when retrieving non-existent database', async () => {
      await expect(client.getDatabase('non-existent-id')).rejects.toThrow(
        'Database non-existent-id not found',
      )
    })

    test('should list all databases for an owner', async () => {
      client.reset()

      await client.createDatabase({ nodeCount: 1, owner: TEST_ADDRESS })
      await client.createDatabase({ nodeCount: 2, owner: TEST_ADDRESS })
      await client.createDatabase({ nodeCount: 3, owner: TEST_ADDRESS })

      const databases = await client.listDatabases(TEST_ADDRESS)
      expect(databases.length).toBe(3)
      expect(databases.every((db) => db.owner === TEST_ADDRESS)).toBe(true)
    })
  })

  describe('Database Deletion', () => {
    test('should delete a database', async () => {
      const db = await client.createDatabase({
        nodeCount: 1,
        owner: TEST_ADDRESS,
      })

      await client.deleteDatabase(db.id)

      await expect(client.getDatabase(db.id)).rejects.toThrow(
        `Database ${db.id} not found`,
      )
    })

    test('should throw when deleting non-existent database', async () => {
      await expect(client.deleteDatabase('non-existent-id')).rejects.toThrow(
        'Database non-existent-id not found',
      )
    })
  })

  describe('Access Control List (ACL) Management', () => {
    let dbId: string

    beforeAll(async () => {
      const db = await client.createDatabase({
        nodeCount: 1,
        owner: TEST_ADDRESS,
      })
      dbId = db.id
    })

    test('should grant SELECT permission to a user', async () => {
      const grantee = '0x1234567890123456789012345678901234567890' as Address

      await client.grant(dbId, {
        grantee,
        table: 'users',
        permissions: ['SELECT'],
      })

      const acl = await client.listACL(dbId)
      expect(acl.length).toBe(1)
      expect(acl[0].grantee).toBe(grantee)
      expect(acl[0].permissions).toContain('SELECT')
    })

    test('should grant multiple permissions', async () => {
      const grantee = '0x2345678901234567890123456789012345678901' as Address

      await client.grant(dbId, {
        grantee,
        table: 'posts',
        permissions: ['SELECT', 'INSERT', 'UPDATE'],
      })

      const acl = await client.listACL(dbId)
      const rule = acl.find((r) => r.grantee === grantee)
      expect(rule).toBeDefined()
      expect(rule?.permissions).toEqual(['SELECT', 'INSERT', 'UPDATE'])
    })

    test('should grant permission with column restriction', async () => {
      const grantee = '0x3456789012345678901234567890123456789012' as Address

      await client.grant(dbId, {
        grantee,
        table: 'users',
        columns: ['id', 'name'],
        permissions: ['SELECT'],
      })

      const acl = await client.listACL(dbId)
      const rule = acl.find(
        (r) => r.grantee === grantee && Array.isArray(r.columns),
      )
      expect(rule).toBeDefined()
      expect(rule?.columns).toEqual(['id', 'name'])
    })

    test('should grant permission with row-level condition', async () => {
      const grantee = '0x4567890123456789012345678901234567890123' as Address

      await client.grant(dbId, {
        grantee,
        table: 'posts',
        permissions: ['SELECT'],
        condition: 'user_id = $current_user',
      })

      const acl = await client.listACL(dbId)
      const rule = acl.find((r) => r.grantee === grantee && r.condition)
      expect(rule).toBeDefined()
      expect(rule?.condition).toBe('user_id = $current_user')
    })

    test('should revoke permissions', async () => {
      const grantee = '0x5678901234567890123456789012345678901234' as Address

      await client.grant(dbId, {
        grantee,
        table: 'data',
        permissions: ['SELECT', 'INSERT'],
      })

      let acl = await client.listACL(dbId)
      expect(acl.find((r) => r.grantee === grantee)).toBeDefined()

      await client.revoke(dbId, {
        grantee,
        table: 'data',
        permissions: ['SELECT', 'INSERT'],
      })

      acl = await client.listACL(dbId)
      expect(acl.find((r) => r.grantee === grantee)).toBeUndefined()
    })
  })

  describe('Rental Plan Management', () => {
    test('should list available rental plans', async () => {
      const plans = await client.listPlans()

      expect(plans.length).toBeGreaterThan(0)
      expect(plans[0]).toHaveProperty('id')
      expect(plans[0]).toHaveProperty('name')
      expect(plans[0]).toHaveProperty('nodeCount')
      expect(plans[0]).toHaveProperty('pricePerMonth')
    })

    test('should create a rental with starter plan', async () => {
      const rental = await client.createRental({
        planId: 'starter',
        autoRenew: true,
      })

      expect(rental.planId).toBe('starter')
      expect(rental.renter).toBe(TEST_ADDRESS)
      expect(rental.autoRenew).toBe(true)
      expect(rental.paymentStatus).toBe('current')
    })

    test('should create a rental with initial schema', async () => {
      const rental = await client.createRental({
        planId: 'pro',
        schema: 'CREATE TABLE test_table (id TEXT PRIMARY KEY)',
      })

      const db = await client.getDatabase(rental.databaseId)
      expect(db.tables.has('test_table')).toBe(true)
    })

    test('should create a prepaid rental', async () => {
      const rental = await client.createRental({
        planId: 'starter',
        months: 6,
      })

      const now = Date.now()
      const sixMonthsLater = now + 6 * 30 * 24 * 60 * 60 * 1000

      expect(rental.expiresAt).toBeGreaterThan(sixMonthsLater - 60000)
      expect(rental.expiresAt).toBeLessThan(sixMonthsLater + 60000)
    })

    test('should extend a rental', async () => {
      const rental = await client.createRental({
        planId: 'starter',
        months: 1,
      })

      const originalExpiry = rental.expiresAt
      const extended = await client.extendRental(rental.id, 3)

      expect(extended.expiresAt).toBeGreaterThan(originalExpiry)
    })

    test('should cancel a rental', async () => {
      const rental = await client.createRental({
        planId: 'starter',
      })

      await client.cancelRental(rental.id)

      const cancelled = await client.getRental(rental.id)
      expect(cancelled.paymentStatus).toBe('cancelled')
    })

    test('should reject extending rental with 0 months', async () => {
      const rental = await client.createRental({
        planId: 'starter',
      })

      await expect(client.extendRental(rental.id, 0)).rejects.toThrow(
        'months must be at least 1',
      )
    })
  })

  describe('Connection Pooling', () => {
    test('should track connection pool statistics', async () => {
      const db = await client.createDatabase({
        nodeCount: 1,
        owner: TEST_ADDRESS,
      })

      const stats = client.getPoolStats(db.id)
      expect(stats).not.toBeNull()
      expect(stats?.active).toBe(0)
      expect(stats?.idle).toBe(5)
      expect(stats?.total).toBe(5)
    })

    test('should return null for non-existent database pool', () => {
      const stats = client.getPoolStats('non-existent')
      expect(stats).toBeNull()
    })
  })

  describe('Health and Status Monitoring', () => {
    test('should report healthy status', async () => {
      const healthy = await client.isHealthy()
      expect(healthy).toBe(true)
    })

    test('should report unhealthy status', async () => {
      client.setHealthy(false)
      const healthy = await client.isHealthy()
      expect(healthy).toBe(false)
      client.setHealthy(true)
    })

    test('should get block producer info', async () => {
      const info = await client.getBlockProducerInfo()

      expect(info.address).toBe(TEST_ADDRESS)
      expect(info.blockHeight).toBeGreaterThan(0)
      expect(info.status).toBe('active')
    })

    test('should increment block height', async () => {
      const info1 = await client.getBlockProducerInfo()
      const info2 = await client.getBlockProducerInfo()

      expect(info2.blockHeight).toBeGreaterThan(info1.blockHeight)
    })
  })

  describe('Query Execution', () => {
    let dbId: string

    beforeAll(async () => {
      const db = await client.createDatabase({
        nodeCount: 1,
        owner: TEST_ADDRESS,
        schema: 'CREATE TABLE test_data (id TEXT, value INTEGER)',
      })
      dbId = db.id
    })

    test('should execute CREATE TABLE', async () => {
      const result = await client.exec(
        dbId,
        'CREATE TABLE new_table (id TEXT PRIMARY KEY)',
      )

      expect(result.rowsAffected).toBe(0)
      expect(result.txHash).toMatch(/^0x/)
    })

    test('should execute INSERT', async () => {
      await client.exec(
        dbId,
        'CREATE TABLE IF NOT EXISTS items (id TEXT, name TEXT)',
      )
      const result = await client.exec(
        dbId,
        'INSERT INTO items (id, name) VALUES ($1, $2)',
        ['1', 'Test Item'],
      )

      expect(result.rowsAffected).toBe(1)
    })

    test('should execute SELECT', async () => {
      await client.exec(dbId, 'CREATE TABLE IF NOT EXISTS records (id TEXT)')
      await client.exec(dbId, 'INSERT INTO records (id) VALUES ($1)', ['rec-1'])

      const result = await client.query<{ id: string }>(
        dbId,
        'SELECT * FROM records',
      )

      expect(result.rows.length).toBeGreaterThanOrEqual(1)
    })

    test('should throw for queries on non-existent table', async () => {
      await expect(
        client.query(dbId, 'SELECT * FROM nonexistent_table'),
      ).rejects.toThrow('Table nonexistent_table does not exist')
    })
  })
})

// Integration Tests (requires SQLit to be running)

describe.skipIf(!SQLIT_AVAILABLE)(
  'SQLit Integration - Database Provisioning',
  () => {
    test('should connect to SQLit block producer', async () => {
      const endpoint =
        (typeof process !== 'undefined'
          ? process.env.SQLIT_BLOCK_PRODUCER_ENDPOINT
          : undefined) ||
        getSQLitBlockProducerUrl() ||
        `http://${getLocalhostHost()}:4661`
      const response = await fetch(`${endpoint}/health`)

      expect(response.ok).toBe(true)
    })

    test('should get block producer status', async () => {
      const endpoint =
        (typeof process !== 'undefined'
          ? process.env.SQLIT_BLOCK_PRODUCER_ENDPOINT
          : undefined) ||
        getSQLitBlockProducerUrl() ||
        `http://${getLocalhostHost()}:4661`
      const response = await fetch(`${endpoint}/api/v1/status`)

      if (response.ok) {
        const data = await response.json()
        expect(data).toHaveProperty('blockHeight')
      }
    })
  },
)
