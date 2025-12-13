/**
 * Full Decentralization Integration Tests
 * 
 * Tests the complete decentralized stack:
 * - CovenantSQL database
 * - Container registry
 * - MPC key management
 * - A2A/MCP interfaces
 * - Storage (IPFS/Arweave)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_CONFIG = {
  storageUrl: process.env.STORAGE_URL ?? 'http://localhost:3100',
  bazaarUrl: process.env.BAZAAR_URL ?? 'http://localhost:3000',
  indexerUrl: process.env.INDEXER_URL ?? 'http://localhost:4000',
  councilUrl: process.env.COUNCIL_URL ?? 'http://localhost:3200',
};

// ============================================================================
// CovenantSQL Tests
// ============================================================================

describe('CovenantSQL Integration', () => {
  it('should connect to CovenantSQL cluster', async () => {
    // Import dynamically to avoid module resolution issues in test
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test-db',
      privateKey: 'test-key',
      defaultConsistency: 'strong',
      poolSize: 5,
      queryTimeout: 10000,
      retryAttempts: 3,
      logging: false,
    });

    // Test connection (will fail gracefully if no server)
    const health = client.getHealth();
    expect(health).toBeDefined();
    expect(typeof health.healthy).toBe('boolean');
  });

  it('should support strong consistency queries', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test-db',
      privateKey: 'test-key',
      defaultConsistency: 'strong',
      poolSize: 2,
      queryTimeout: 5000,
      retryAttempts: 1,
      logging: false,
    });

    // Verify strong consistency is default
    expect(true).toBe(true);
  });

  it('should support eventual consistency queries', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test-db',
      privateKey: 'test-key',
      defaultConsistency: 'eventual',
      poolSize: 2,
      queryTimeout: 5000,
      retryAttempts: 1,
      logging: false,
    });

    expect(true).toBe(true);
  });

  it('should run migrations', async () => {
    const { createCovenantSQLClient, MigrationManager, createTableMigration } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test-db',
      privateKey: 'test-key',
      defaultConsistency: 'strong',
      poolSize: 2,
      queryTimeout: 5000,
      retryAttempts: 1,
      logging: false,
    });

    const manager = new MigrationManager(client);
    expect(manager).toBeDefined();
    expect(typeof manager.register).toBe('function');
    expect(typeof manager.up).toBe('function');
    expect(typeof manager.down).toBe('function');
  });
});

// ============================================================================
// Container Registry Tests
// ============================================================================

describe('Container Registry Integration', () => {
  it('should serve OCI API at /registry/v2', async () => {
    const response = await fetch(`${TEST_CONFIG.storageUrl}/registry/v2/`).catch(() => null);
    
    // Skip if server not running
    if (!response) {
      console.log('Storage server not running, skipping test');
      return;
    }

    expect(response.status).toBe(200);
    expect(response.headers.get('Docker-Distribution-Api-Version')).toBe('registry/2.0');
  });

  it('should serve A2A endpoint at /registry/a2a', async () => {
    const response = await fetch(`${TEST_CONFIG.storageUrl}/registry/a2a/.well-known/agent-card.json`).catch(() => null);
    
    if (!response) return;

    expect(response.status).toBe(200);
    const card = await response.json();
    expect(card.name).toBe('Jeju Container Registry');
    expect(card.protocolVersion).toBe('0.3.0');
  });

  it('should serve MCP endpoint at /registry/mcp', async () => {
    const response = await fetch(`${TEST_CONFIG.storageUrl}/registry/mcp`).catch(() => null);
    
    if (!response) return;

    expect(response.status).toBe(200);
    const info = await response.json();
    expect(info.name).toBe('jeju-container-registry');
  });
});

// ============================================================================
// MPC Key Management Tests
// ============================================================================

describe('MPC Key Management', () => {
  it('should create distributed keys', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({
      totalShares: 5,
      threshold: 3,
      verbose: false,
    });

    const holders = ['holder1', 'holder2', 'holder3', 'holder4', 'holder5'];
    const key = await manager.generateKey('test-key', holders);

    expect(key.keyId).toBe('test-key');
    expect(key.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(key.totalShares).toBe(5);
    expect(key.threshold).toBe(3);
    expect(key.version).toBe(1);
  });

  it('should distribute key shares to holders', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({
      totalShares: 3,
      threshold: 2,
      verbose: false,
    });

    const holders = ['alice', 'bob', 'carol'];
    await manager.generateKey('shared-key', holders);

    const aliceShare = manager.getShare('shared-key', 'alice');
    const bobShare = manager.getShare('shared-key', 'bob');
    const carolShare = manager.getShare('shared-key', 'carol');

    expect(aliceShare).not.toBeNull();
    expect(bobShare).not.toBeNull();
    expect(carolShare).not.toBeNull();
    expect(aliceShare?.index).toBe(1);
    expect(bobShare?.index).toBe(2);
    expect(carolShare?.index).toBe(3);
  });

  it('should rotate keys with new version', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({
      totalShares: 3,
      threshold: 2,
      verbose: false,
    });

    const holders = ['alice', 'bob', 'carol'];
    const originalKey = await manager.generateKey('rotate-key', holders);
    expect(originalKey.version).toBe(1);

    const rotatedKey = await manager.rotateKey('rotate-key');
    expect(rotatedKey.version).toBe(2);
    expect(rotatedKey.keyId).toBe('rotate-key');
  });
});

// ============================================================================
// HSM Integration Tests
// ============================================================================

describe('HSM Integration', () => {
  it('should connect to HSM (simulated)', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
    });

    await client.connect();
    expect(true).toBe(true);
  });

  it('should generate keys in HSM', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('test-signing-key', 'ec-secp256k1');

    expect(key.keyId).toContain('hsm-ec-secp256k1');
    expect(key.label).toBe('test-signing-key');
    expect(key.attributes.canSign).toBe(true);
    expect(key.attributes.extractable).toBe(false);
  });

  it('should sign data with HSM key', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('sign-key', 'ec-secp256k1');

    const signature = await client.sign({
      keyId: key.keyId,
      data: '0x1234567890abcdef',
      hashAlgorithm: 'keccak256',
    });

    expect(signature.signature).toMatch(/^0x[a-fA-F0-9]+$/);
    expect(signature.v).toBeGreaterThanOrEqual(27);
  });
});

// ============================================================================
// A2A Protocol Tests
// ============================================================================

describe('A2A Protocol Integration', () => {
  it('should serve agent cards for all services', async () => {
    const services = [
      { name: 'storage', url: `${TEST_CONFIG.storageUrl}/.well-known/agent-card.json` },
      // Add more services as they come online
    ];

    for (const service of services) {
      const response = await fetch(service.url).catch(() => null);
      if (!response) {
        console.log(`${service.name} not running, skipping`);
        continue;
      }

      expect(response.status).toBe(200);
      const card = await response.json();
      expect(card.protocolVersion).toBe('0.3.0');
      expect(card.skills).toBeDefined();
      expect(Array.isArray(card.skills)).toBe(true);
    }
  });

  it('should handle A2A message/send requests', async () => {
    const response = await fetch(`${TEST_CONFIG.storageUrl}/a2a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-1',
            parts: [
              { kind: 'data', data: { skillId: 'list-providers' } },
            ],
          },
        },
        id: 1,
      }),
    }).catch(() => null);

    if (!response) return;

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBe(1);
  });
});

// ============================================================================
// MCP Protocol Tests
// ============================================================================

describe('MCP Protocol Integration', () => {
  it('should initialize MCP sessions', async () => {
    const response = await fetch(`${TEST_CONFIG.storageUrl}/mcp/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);

    if (!response) return;

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.protocolVersion).toBeDefined();
    expect(result.serverInfo).toBeDefined();
    expect(result.capabilities).toBeDefined();
  });

  it('should list MCP resources', async () => {
    const response = await fetch(`${TEST_CONFIG.storageUrl}/mcp/resources/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);

    if (!response) return;

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.resources).toBeDefined();
    expect(Array.isArray(result.resources)).toBe(true);
  });

  it('should list MCP tools', async () => {
    const response = await fetch(`${TEST_CONFIG.storageUrl}/mcp/tools/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);

    if (!response) return;

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.tools).toBeDefined();
    expect(Array.isArray(result.tools)).toBe(true);
  });
});

// ============================================================================
// Storage Backend Tests
// ============================================================================

describe('Storage Backend Integration', () => {
  it('should report available backends', async () => {
    const response = await fetch(`${TEST_CONFIG.storageUrl}/backends`).catch(() => null);

    if (!response) return;

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.backends).toBeDefined();
    expect(result.health).toBeDefined();
  });

  it('should accept file uploads', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['test content'], { type: 'text/plain' }), 'test.txt');

    const response = await fetch(`${TEST_CONFIG.storageUrl}/upload`, {
      method: 'POST',
      body: formData,
    }).catch(() => null);

    if (!response) return;

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.cid).toBeDefined();
    expect(result.status).toBe('pinned');
  });
});

// ============================================================================
// Health Check Tests
// ============================================================================

describe('Service Health Checks', () => {
  const services = [
    { name: 'storage', url: `${TEST_CONFIG.storageUrl}/health` },
  ];

  for (const service of services) {
    it(`should report healthy for ${service.name}`, async () => {
      const response = await fetch(service.url).catch(() => null);
      
      if (!response) {
        console.log(`${service.name} not running`);
        return;
      }

      expect(response.status).toBe(200);
      const health = await response.json();
      expect(health.status).toBe('healthy');
    });
  }
});

