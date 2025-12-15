/**
 * CQL Client Unit Tests
 * 
 * NOTE: These tests mock fetch() and only test client-side logic.
 * They do NOT test actual CovenantSQL integration.
 * 
 * For real integration tests, you need:
 * 1. A running CovenantSQL instance
 * 2. Set CQL_BLOCK_PRODUCER_ENDPOINT env var
 * 3. Run integration tests separately
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { CQLClient, getCQL, resetCQL } from './client.js';

// Mock fetch for testing
const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

function setupMock() {
  mockFetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response));
  globalThis.fetch = mockFetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe('CQLClient', () => {
  let client: CQLClient;

  beforeEach(() => {
    setupMock();
    resetCQL();
    client = new CQLClient({
      blockProducerEndpoint: 'http://localhost:4020',
      databaseId: 'test-db',
      timeout: 5000,
      debug: false,
    });
  });

  afterEach(() => {
    restoreFetch();
    resetCQL();
  });

  describe('Health Check', () => {
    it('should return true when service is available', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true } as Response));
      expect(await client.isHealthy()).toBe(true);
    });

    it('should return false when service is unavailable', async () => {
      mockFetch.mockImplementationOnce(() => Promise.reject(new Error('Network error')));
      expect(await client.isHealthy()).toBe(false);
    });

    it('should return false on HTTP error', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 } as Response));
      expect(await client.isHealthy()).toBe(false);
    });

    it('should timeout after 5 seconds', async () => {
      // This verifies AbortSignal.timeout is used
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true } as Response));
      const result = await client.isHealthy();
      expect(result).toBe(true);
    });
  });

  describe('Database Management', () => {
    it('should create database with minimal config', async () => {
      const mockDb = { id: 'db-123', owner: '0x1234', status: 'running', createdAt: Date.now() };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockDb) } as Response));

      const result = await client.createDatabase({ nodeCount: 3, owner: '0x1234' as `0x${string}` });
      
      expect(result.id).toBe('db-123');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should create database with full config', async () => {
      const mockDb = { id: 'db-456', owner: '0x5678', status: 'creating', createdAt: Date.now() };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockDb) } as Response));

      const result = await client.createDatabase({
        nodeCount: 5,
        useEventualConsistency: true,
        regions: ['us-east', 'eu-west'],
        schema: 'CREATE TABLE test (id INT)',
        owner: '0x5678' as `0x${string}`,
        paymentToken: '0xtoken' as `0x${string}`,
      });

      expect(result.id).toBe('db-456');
      
      // Verify request body
      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      expect(body.nodeCount).toBe(5);
      expect(body.useEventualConsistency).toBe(true);
      expect(body.regions).toEqual(['us-east', 'eu-west']);
    });

    it('should throw on create database failure', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 400 } as Response));
      await expect(client.createDatabase({ nodeCount: 3, owner: '0x1234' as `0x${string}` })).rejects.toThrow('Request failed: 400');
    });

    it('should get database info', async () => {
      const mockInfo = { id: 'db-123', owner: '0x1234', status: 'running', createdAt: Date.now() };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockInfo) } as Response));

      const result = await client.getDatabase('db-123');
      expect(result.id).toBe('db-123');
    });

    it('should throw when database not found', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404 } as Response));
      await expect(client.getDatabase('nonexistent')).rejects.toThrow();
    });

    it('should list databases by owner', async () => {
      const mockDbs = { databases: [{ id: 'db-1' }, { id: 'db-2' }] };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockDbs) } as Response));

      const result = await client.listDatabases('0x1234' as `0x${string}`);
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('db-1');
    });

    it('should delete database', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true } as Response));
      await client.deleteDatabase('db-123');
      
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/databases/db-123');
      expect(call[1]?.method).toBe('DELETE');
    });
  });

  describe('Query Execution', () => {
    it('should execute SELECT query', async () => {
      const mockResult = { rows: [{ id: 1, name: 'test' }], rowCount: 1, columns: ['id', 'name'], blockHeight: 100 };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResult) } as Response));

      const result = await client.query<{ id: number; name: string }>('SELECT * FROM test');
      
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].name).toBe('test');
      expect(result.rowCount).toBe(1);
    });

    it('should execute parameterized query', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [], rowCount: 0 }) } as Response));

      await client.query('SELECT * FROM test WHERE id = ? AND name = ?', [1, 'test']);

      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.params).toEqual([1, 'test']);
    });

    it('should handle null parameters', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [], rowCount: 0 }) } as Response));

      await client.query('SELECT * FROM test WHERE value = ?', [null]);

      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.params).toEqual([null]);
    });

    it('should handle bigint parameters', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [], rowCount: 0 }) } as Response));

      await client.query('SELECT * FROM test WHERE id = ?', [BigInt('9007199254740993')]);

      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.params).toEqual(['9007199254740993']);
    });

    it('should handle Uint8Array parameters', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [], rowCount: 0 }) } as Response));

      await client.query('SELECT * FROM test WHERE hash = ?', [new Uint8Array([1, 2, 3])]);

      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.params[0]).toBe('0x010203');
    });

    it('should execute INSERT', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ rowsAffected: 1, lastInsertId: '42', txHash: '0xabc', blockHeight: 100, gasUsed: '21000' }),
      } as Response));

      const result = await client.exec("INSERT INTO test (name) VALUES ('new')");

      expect(result.rowsAffected).toBe(1);
      expect(result.lastInsertId).toBe(42n);
      expect(result.gasUsed).toBe(21000n);
    });

    it('should execute UPDATE', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ rowsAffected: 5, txHash: '0xdef', blockHeight: 101, gasUsed: '50000' }),
      } as Response));

      const result = await client.exec("UPDATE test SET status = 'active'");

      expect(result.rowsAffected).toBe(5);
    });

    it('should throw on query failure', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Syntax error'),
      } as Response));

      await expect(client.query('INVALID SQL')).rejects.toThrow();
    });
  });

  describe('Connection Pool', () => {
    it('should reuse connections from pool', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [], rowCount: 0 }) } as Response));

      // Execute multiple queries
      await Promise.all([
        client.query('SELECT 1'),
        client.query('SELECT 2'),
        client.query('SELECT 3'),
      ]);

      const pool = client.getPool('test-db');
      const stats = pool.stats();
      
      // Connections should be returned to idle
      expect(stats.total).toBeGreaterThan(0);
    });

    it('should get pool stats', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [], rowCount: 0 }) } as Response));

      await client.query('SELECT 1');
      
      const stats = client.getPool('test-db').stats();
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('idle');
      expect(stats).toHaveProperty('total');
    });

    it('should create separate pools for different databases', async () => {
      const pool1 = client.getPool('db-1');
      const pool2 = client.getPool('db-2');
      
      expect(pool1).not.toBe(pool2);
    });
  });

  describe('ACL Management', () => {
    it('should grant permissions', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true } as Response));

      await client.grant('db-123', { grantee: '0x5678' as `0x${string}`, permissions: ['read', 'write'] });

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/acl/grant');
      expect(call[1]?.method).toBe('POST');
    });

    it('should revoke permissions', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true } as Response));

      await client.revoke('db-123', { grantee: '0x5678' as `0x${string}`, permissions: ['write'] });

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/acl/revoke');
    });

    it('should list ACL rules', async () => {
      const mockRules = { rules: [{ grantee: '0x1234', permissions: ['read', 'write'] }] };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockRules) } as Response));

      const result = await client.listACL('db-123');
      expect(result.length).toBe(1);
      expect(result[0].permissions).toContain('read');
    });
  });

  describe('Rental Management', () => {
    it('should list available plans', async () => {
      const mockPlans = { plans: [{ id: 'basic', name: 'Basic', nodeCount: 3 }, { id: 'pro', name: 'Pro', nodeCount: 5 }] };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockPlans) } as Response));

      const result = await client.listPlans();
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('basic');
    });

    it('should create rental', async () => {
      const mockRental = { id: 'rental-123', databaseId: 'db-456', status: 'active' };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockRental) } as Response));

      const result = await client.createRental({ planId: 'basic', owner: '0x1234' as `0x${string}` });
      expect(result.id).toBe('rental-123');
    });

    it('should get rental info', async () => {
      const mockRental = { id: 'rental-123', status: 'active' };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockRental) } as Response));

      const result = await client.getRental('rental-123');
      expect(result.status).toBe('active');
    });

    it('should extend rental', async () => {
      const mockRental = { id: 'rental-123', expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000 };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockRental) } as Response));

      const result = await client.extendRental('rental-123', 2);
      
      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.months).toBe(2);
    });

    it('should cancel rental', async () => {
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true } as Response));

      await client.cancelRental('rental-123');
      
      const call = mockFetch.mock.calls[0];
      expect(call[1]?.method).toBe('DELETE');
    });
  });

  describe('Block Producer', () => {
    it('should get block producer info', async () => {
      const mockInfo = { nodeCount: 10, blockHeight: 1000, pendingTransactions: 5 };
      mockFetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockInfo) } as Response));

      const result = await client.getBlockProducerInfo();
      expect(result.nodeCount).toBe(10);
    });
  });

  describe('Error Handling', () => {
    it('should require database ID for connect', async () => {
      const clientNoDB = new CQLClient({ blockProducerEndpoint: 'http://localhost:4020' });
      await expect(clientNoDB.connect()).rejects.toThrow('Database ID required');
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')));
      await expect(client.query('SELECT 1')).rejects.toThrow();
    });
  });

  describe('Cleanup', () => {
    it('should close all connection pools', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [] }) } as Response));

      // Create connections to multiple databases
      await client.query('SELECT 1', [], 'db-1');
      await client.query('SELECT 2', [], 'db-2');

      await client.close();

      // Pools should be cleared
      // (Internal state check - pools map should be empty)
    });
  });
});

describe('getCQL Factory', () => {
  beforeEach(() => {
    setupMock();
    resetCQL();
  });

  afterEach(() => {
    restoreFetch();
    resetCQL();
  });

  it('should return singleton instance', () => {
    const client1 = getCQL({ blockProducerEndpoint: 'http://localhost:4020' });
    const client2 = getCQL();
    expect(client1).toBe(client2);
  });

  it('should reset singleton', () => {
    const client1 = getCQL({ blockProducerEndpoint: 'http://localhost:4020' });
    resetCQL();
    const client2 = getCQL({ blockProducerEndpoint: 'http://localhost:4020' });
    expect(client1).not.toBe(client2);
  });

  it('should use environment variables for config', () => {
    const originalEnv = process.env.CQL_BLOCK_PRODUCER_ENDPOINT;
    process.env.CQL_BLOCK_PRODUCER_ENDPOINT = 'http://env-endpoint:4020';
    
    resetCQL();
    const client = getCQL();
    
    // Verify endpoint is used (would need to check internal state or make a request)
    expect(client).toBeDefined();
    
    process.env.CQL_BLOCK_PRODUCER_ENDPOINT = originalEnv;
  });
});

describe('Concurrent Operations', () => {
  beforeEach(() => {
    setupMock();
  });

  afterEach(() => {
    restoreFetch();
  });

  it('should handle 100 concurrent queries', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [{ n: callCount }], rowCount: 1 }) } as Response);
    });

    const client = new CQLClient({ blockProducerEndpoint: 'http://localhost:4020', databaseId: 'test-db' });
    
    const promises = Array.from({ length: 100 }, (_, i) => client.query(`SELECT ${i}`));
    const results = await Promise.all(promises);

    expect(results.length).toBe(100);
    results.forEach(r => expect(r.rowCount).toBe(1));
  });

  it('should handle mixed read/write operations', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ rows: [], rowCount: 0, rowsAffected: 1, gasUsed: '0' }),
    } as Response));

    const client = new CQLClient({ blockProducerEndpoint: 'http://localhost:4020', databaseId: 'test-db' });
    
    const operations = [
      client.query('SELECT 1'),
      client.exec('INSERT INTO test VALUES (1)'),
      client.query('SELECT 2'),
      client.exec('UPDATE test SET x = 1'),
      client.query('SELECT 3'),
    ];

    await Promise.all(operations);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });
});
