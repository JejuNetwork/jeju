/**
 * SecureCQLClient Unit Tests
 *
 * Tests for the secure client with cryptographic authentication
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createSecureCQLClient, SecureCQLClient } from './secure-client.js'

// Test constants
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const TEST_DWS_ENDPOINT = 'http://localhost:4030'

// Mock fetch for testing
const originalFetch = globalThis.fetch

describe('SecureCQLClient', () => {
  let client: SecureCQLClient
  let mockFetch: ReturnType<typeof mock>

  function setupMock() {
    mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response),
    )
    globalThis.fetch = mockFetch
  }

  function restoreFetch() {
    globalThis.fetch = originalFetch
  }

  beforeEach(() => {
    setupMock()
    client = new SecureCQLClient({
      dwsEndpoint: TEST_DWS_ENDPOINT,
      privateKey: TEST_PRIVATE_KEY,
      appName: 'test-app',
    })
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('constructor', () => {
    it('should create client with required config', () => {
      const c = new SecureCQLClient({
        dwsEndpoint: TEST_DWS_ENDPOINT,
        privateKey: TEST_PRIVATE_KEY,
        appName: 'my-app',
      })

      expect(c.address).toBe(TEST_ADDRESS)
      expect(c.database).toBeNull()
    })

    it('should accept databaseId in config', () => {
      const c = new SecureCQLClient({
        dwsEndpoint: TEST_DWS_ENDPOINT,
        privateKey: TEST_PRIVATE_KEY,
        appName: 'my-app',
        databaseId: 'existing-db',
      })

      expect(c.database).toBe('existing-db')
    })

    it('should derive correct address from private key', () => {
      // Known private key -> address mapping (from anvil/hardhat)
      expect(client.address).toBe(TEST_ADDRESS)
    })
  })

  describe('createSecureCQLClient factory', () => {
    it('should create client instance', () => {
      const c = createSecureCQLClient({
        dwsEndpoint: TEST_DWS_ENDPOINT,
        privateKey: TEST_PRIVATE_KEY,
        appName: 'factory-app',
      })

      expect(c).toBeInstanceOf(SecureCQLClient)
      expect(c.address).toBe(TEST_ADDRESS)
    })
  })

  describe('provision', () => {
    it('should provision a new database', async () => {
      const mockDb = {
        success: true,
        database: {
          databaseId: 'db-123',
          owner: TEST_ADDRESS,
          appName: 'test-app',
          createdAt: Date.now(),
          status: 'active' as const,
        },
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDb),
        } as Response),
      )

      const result = await client.provision()

      expect(result.databaseId).toBe('db-123')
      expect(result.appName).toBe('test-app')
      expect(client.database).toBe('db-123')
    })

    it('should provision with initial schema', async () => {
      const mockDb = {
        success: true,
        database: {
          databaseId: 'db-456',
          owner: TEST_ADDRESS,
          appName: 'test-app',
          createdAt: Date.now(),
          status: 'active' as const,
        },
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDb),
        } as Response),
      )

      await client.provision('CREATE TABLE users (id TEXT PRIMARY KEY)')

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1]?.body as string)
      expect(body.schema).toBe('CREATE TABLE users (id TEXT PRIMARY KEY)')
    })

    it('should include signature in provision request', async () => {
      const mockDb = {
        success: true,
        database: {
          databaseId: 'db-789',
          owner: TEST_ADDRESS,
          appName: 'test-app',
          createdAt: Date.now(),
          status: 'active' as const,
        },
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDb),
        } as Response),
      )

      await client.provision()

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1]?.body as string)
      expect(body.signature).toBeDefined()
      expect(body.signature).toMatch(/^0x[a-fA-F0-9]+$/)
      expect(body.owner).toBe(TEST_ADDRESS)
      expect(body.appName).toBe('test-app')
    })

    it('should throw on provision failure', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: 'App name already exists' }),
        } as Response),
      )

      await expect(client.provision()).rejects.toThrow(
        'Failed to provision database: App name already exists',
      )
    })
  })

  describe('query', () => {
    beforeEach(async () => {
      // First provision a database
      const mockDb = {
        success: true,
        database: {
          databaseId: 'test-db',
          owner: TEST_ADDRESS,
          appName: 'test-app',
          createdAt: Date.now(),
          status: 'active' as const,
        },
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDb),
        } as Response),
      )
      await client.provision()
      mockFetch.mockClear()
    })

    it('should execute SELECT query', async () => {
      const mockResult = {
        rows: [{ id: '1', name: 'Alice' }],
        rowCount: 1,
        columns: ['id', 'name'],
        blockHeight: 100,
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResult),
        } as Response),
      )

      const result = await client.query<{ id: string; name: string }>(
        'SELECT * FROM users',
      )

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].name).toBe('Alice')
    })

    it('should execute parameterized query', async () => {
      const mockResult = {
        rows: [],
        rowCount: 0,
        columns: [],
        blockHeight: 100,
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResult),
        } as Response),
      )

      await client.query('SELECT * FROM users WHERE id = ? AND status = ?', [
        '123',
        'active',
      ])

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1]?.body as string)
      expect(body.params).toEqual(['123', 'active'])
    })

    it('should include signature in query', async () => {
      const mockResult = {
        rows: [],
        rowCount: 0,
        columns: [],
        blockHeight: 100,
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResult),
        } as Response),
      )

      await client.query('SELECT 1')

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1]?.body as string)
      expect(body.signature).toMatch(/^0x[a-fA-F0-9]+$/)
      expect(body.signer).toBe(TEST_ADDRESS)
    })

    it('should throw if database not provisioned', async () => {
      const freshClient = new SecureCQLClient({
        dwsEndpoint: TEST_DWS_ENDPOINT,
        privateKey: TEST_PRIVATE_KEY,
        appName: 'test-app',
      })

      await expect(freshClient.query('SELECT 1')).rejects.toThrow(
        'Database not provisioned',
      )
    })
  })

  describe('exec', () => {
    beforeEach(async () => {
      // First provision a database
      const mockDb = {
        success: true,
        database: {
          databaseId: 'test-db',
          owner: TEST_ADDRESS,
          appName: 'test-app',
          createdAt: Date.now(),
          status: 'active' as const,
        },
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDb),
        } as Response),
      )
      await client.provision()
      mockFetch.mockClear()
    })

    it('should execute INSERT statement', async () => {
      const mockResult = {
        rowsAffected: 1,
        lastInsertId: '42',
        txHash: '0xabc',
        blockHeight: 100,
        gasUsed: '21000',
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResult),
        } as Response),
      )

      const result = await client.exec('INSERT INTO users (name) VALUES (?)', [
        'Bob',
      ])

      expect(result.rowsAffected).toBe(1)
      expect(result.lastInsertId).toBe('42')
    })

    it('should throw on exec failure', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: 'Syntax error' }),
        } as Response),
      )

      await expect(client.exec('INVALID SQL')).rejects.toThrow(
        'CQL exec failed: Syntax error',
      )
    })
  })

  describe('grantAccess', () => {
    beforeEach(async () => {
      const mockDb = {
        success: true,
        database: {
          databaseId: 'test-db',
          owner: TEST_ADDRESS,
          appName: 'test-app',
          createdAt: Date.now(),
          status: 'active' as const,
        },
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDb),
        } as Response),
      )
      await client.provision()
      mockFetch.mockClear()
    })

    it('should grant access to another address', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response),
      )

      await client.grantAccess({
        grantee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        tables: ['users'],
        permissions: ['SELECT'],
      })

      const call = mockFetch.mock.calls[0]
      expect(call[0]).toContain('/database/grant')
      const body = JSON.parse(call[1]?.body as string)
      expect(body.grantee).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
      expect(body.tables).toEqual(['users'])
      expect(body.permissions).toEqual(['SELECT'])
    })

    it('should grant access to all tables', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response),
      )

      await client.grantAccess({
        grantee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        tables: '*',
        permissions: ['ALL'],
      })

      const call = mockFetch.mock.calls[0]
      const body = JSON.parse(call[1]?.body as string)
      expect(body.tables).toBe('*')
    })

    it('should throw if database not provisioned', async () => {
      const freshClient = new SecureCQLClient({
        dwsEndpoint: TEST_DWS_ENDPOINT,
        privateKey: TEST_PRIVATE_KEY,
        appName: 'test-app',
      })

      await expect(
        freshClient.grantAccess({
          grantee: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          tables: ['users'],
          permissions: ['SELECT'],
        }),
      ).rejects.toThrow('Database not provisioned')
    })
  })

  describe('revokeAccess', () => {
    beforeEach(async () => {
      const mockDb = {
        success: true,
        database: {
          databaseId: 'test-db',
          owner: TEST_ADDRESS,
          appName: 'test-app',
          createdAt: Date.now(),
          status: 'active' as const,
        },
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDb),
        } as Response),
      )
      await client.provision()
      mockFetch.mockClear()
    })

    it('should revoke access from an address', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        } as Response),
      )

      await client.revokeAccess('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')

      const call = mockFetch.mock.calls[0]
      expect(call[0]).toContain('/database/revoke')
      const body = JSON.parse(call[1]?.body as string)
      expect(body.grantee).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
    })
  })

  describe('listDatabases', () => {
    it('should list all databases for owner', async () => {
      const mockDbs = {
        databases: [
          {
            databaseId: 'db-1',
            owner: TEST_ADDRESS,
            appName: 'app-1',
            createdAt: Date.now(),
            status: 'active' as const,
          },
          {
            databaseId: 'db-2',
            owner: TEST_ADDRESS,
            appName: 'app-2',
            createdAt: Date.now(),
            status: 'active' as const,
          },
        ],
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDbs),
        } as Response),
      )

      const result = await client.listDatabases()

      expect(result).toHaveLength(2)
      expect(result[0].databaseId).toBe('db-1')
      expect(result[1].appName).toBe('app-2')
    })

    it('should call correct endpoint with owner address', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ databases: [] }),
        } as Response),
      )

      await client.listDatabases()

      const call = mockFetch.mock.calls[0]
      expect(call[0]).toContain(`/database/list/${TEST_ADDRESS}`)
    })
  })

  describe('setDatabase', () => {
    it('should set the current database ID', () => {
      expect(client.database).toBeNull()

      client.setDatabase('new-db-id')

      expect(client.database).toBe('new-db-id')
    })

    it('should allow operations after setting database', async () => {
      client.setDatabase('existing-db')

      const mockResult = {
        rows: [],
        rowCount: 0,
        columns: [],
        blockHeight: 100,
      }
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResult),
        } as Response),
      )

      const result = await client.query('SELECT 1')
      expect(result.blockHeight).toBe(100)
    })
  })
})
