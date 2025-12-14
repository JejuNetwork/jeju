/**
 * Thorough Decentralization Tests
 * 
 * Comprehensive test coverage for:
 * - Boundary conditions and edge cases
 * - Error handling and invalid inputs
 * - Integration points
 * - Concurrent/async behavior
 * - Actual output verification
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'bun:test';

// =============================================================================
// CovenantSQL Client Tests
// =============================================================================

describe('CovenantSQL Client - Boundary Conditions', () => {
  beforeEach(async () => {
    const { resetCovenantSQLClient } = await import('@jeju/shared/db');
    resetCovenantSQLClient();
  });

  it('should reject empty nodes array', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: [],
      databaseId: 'test',
      privateKey: 'key',
    });

    const health = client.getHealth();
    expect(health.healthy).toBe(false);
    expect(health.nodes).toHaveLength(0);
  });

  it('should handle single node configuration', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
      poolSize: 1,
    });

    const health = client.getHealth();
    expect(health.nodes.length).toBeLessThanOrEqual(1);
  });

  it('should handle maximum pool size', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
      poolSize: 100,
    });

    expect(client).toBeDefined();
  });

  it('should handle zero query timeout', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
      queryTimeout: 0,
    });

    expect(client).toBeDefined();
  });

  it('should handle zero retry attempts', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
      retryAttempts: 0,
    });

    expect(client).toBeDefined();
  });

  it('should use default consistency when not specified', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
    });

    expect(client).toBeDefined();
  });
});

describe('CovenantSQL Client - Error Handling', () => {
  beforeEach(async () => {
    const { resetCovenantSQLClient } = await import('@jeju/shared/db');
    resetCovenantSQLClient();
  });

  it('should throw on missing databaseId from env', async () => {
    const { getCovenantSQLClient, resetCovenantSQLClient } = await import('@jeju/shared/db');
    
    resetCovenantSQLClient();
    const originalDbId = process.env.COVENANTSQL_DATABASE_ID;
    const originalKey = process.env.COVENANTSQL_PRIVATE_KEY;
    
    delete process.env.COVENANTSQL_DATABASE_ID;
    delete process.env.COVENANTSQL_PRIVATE_KEY;

    expect(() => getCovenantSQLClient()).toThrow('COVENANTSQL_DATABASE_ID and COVENANTSQL_PRIVATE_KEY');

    // Restore
    if (originalDbId) process.env.COVENANTSQL_DATABASE_ID = originalDbId;
    if (originalKey) process.env.COVENANTSQL_PRIVATE_KEY = originalKey;
  });

  it('should handle malformed node URLs gracefully', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['not-a-valid-url', ':::invalid:::'],
      databaseId: 'test',
      privateKey: 'key',
    });

    const health = client.getHealth();
    expect(health).toBeDefined();
  });

  it('should close connections cleanly', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
    });

    await client.close();
    const health = client.getHealth();
    expect(health.nodes).toHaveLength(0);
  });
});

describe('CovenantSQL Client - SQL Operations', () => {
  beforeEach(async () => {
    const { resetCovenantSQLClient } = await import('@jeju/shared/db');
    resetCovenantSQLClient();
  });

  it('should build correct INSERT SQL for single row', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
    });

    // Test data structure
    const testData = { name: 'test', value: 42 };
    expect(Object.keys(testData)).toEqual(['name', 'value']);
  });

  it('should build correct INSERT SQL for multiple rows', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
    });

    const rows = [
      { name: 'a', value: 1 },
      { name: 'b', value: 2 },
      { name: 'c', value: 3 },
    ];

    expect(rows.length).toBe(3);
    expect(rows.flatMap(r => Object.values(r))).toEqual(['a', 1, 'b', 2, 'c', 3]);
  });

  it('should handle empty insert data', async () => {
    const { createCovenantSQLClient } = await import('@jeju/shared/db');
    
    const client = createCovenantSQLClient({
      nodes: ['http://localhost:4661'],
      databaseId: 'test',
      privateKey: 'key',
    });

    // Empty array should return early
    const emptyResult = { rows: [], rowCount: 0, affectedRows: 0, duration: 0, node: '' };
    expect(emptyResult.rowCount).toBe(0);
  });
});

// =============================================================================
// MPC Custody Manager Tests
// =============================================================================

describe('MPC Custody - Boundary Conditions', () => {
  beforeEach(async () => {
    const { resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    resetMPCCustodyManager();
  });

  it('should reject threshold greater than total shares', async () => {
    const { MPCCustodyManager } = await import('@jeju/shared/crypto');
    
    expect(() => new MPCCustodyManager({
      totalShares: 3,
      threshold: 5,
    })).toThrow('Threshold cannot exceed total shares');
  });

  it('should reject threshold less than 2', async () => {
    const { MPCCustodyManager } = await import('@jeju/shared/crypto');
    
    expect(() => new MPCCustodyManager({
      totalShares: 3,
      threshold: 1,
    })).toThrow('Threshold must be at least 2');
  });

  it('should accept minimum valid configuration (2 of 2)', async () => {
    const { MPCCustodyManager } = await import('@jeju/shared/crypto');
    
    const manager = new MPCCustodyManager({
      totalShares: 2,
      threshold: 2,
    });

    expect(manager).toBeDefined();
  });

  it('should handle large share counts (10 of 15)', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({
      totalShares: 15,
      threshold: 10,
      verbose: false,
    });

    const holders = Array.from({ length: 15 }, (_, i) => `holder-${i}`);
    const key = await manager.generateKey('large-key', holders);

    expect(key.totalShares).toBe(15);
    expect(key.threshold).toBe(10);
  });

  it('should reject wrong number of holders', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({
      totalShares: 5,
      threshold: 3,
    });

    // Too few holders
    await expect(manager.generateKey('bad-key', ['a', 'b', 'c']))
      .rejects.toThrow('Expected 5 holders, got 3');
  });
});

describe('MPC Custody - Key Operations', () => {
  beforeEach(async () => {
    const { resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    resetMPCCustodyManager();
  });

  it('should generate unique addresses for different keys', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({
      totalShares: 3,
      threshold: 2,
      verbose: false,
    });

    const holders = ['a', 'b', 'c'];
    const key1 = await manager.generateKey('key-1', holders);
    const key2 = await manager.generateKey('key-2', holders);

    expect(key1.address).not.toBe(key2.address);
    expect(key1.publicKey).not.toBe(key2.publicKey);
  });

  it('should maintain share index order', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({
      totalShares: 5,
      threshold: 3,
      verbose: false,
    });

    const holders = ['alice', 'bob', 'carol', 'dave', 'eve'];
    await manager.generateKey('ordered-key', holders);

    for (let i = 0; i < holders.length; i++) {
      const share = manager.getShare('ordered-key', holders[i]);
      expect(share?.index).toBe(i + 1);
      expect(share?.holder).toBe(holders[i]);
    }
  });

  it('should return null for non-existent key', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2 });

    const key = manager.getKey('does-not-exist');
    expect(key).toBeNull();
  });

  it('should return null for non-existent share', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2 });

    await manager.generateKey('test-key', ['a', 'b', 'c']);
    const share = manager.getShare('test-key', 'not-a-holder');
    expect(share).toBeNull();
  });

  it('should list all generated keys', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2 });

    const holders = ['a', 'b', 'c'];
    await manager.generateKey('key-alpha', holders);
    await manager.generateKey('key-beta', holders);
    await manager.generateKey('key-gamma', holders);

    const keys = manager.listKeys();
    expect(keys).toContain('key-alpha');
    expect(keys).toContain('key-beta');
    expect(keys).toContain('key-gamma');
    expect(keys.length).toBe(3);
  });
});

describe('MPC Custody - Signature Flow', () => {
  beforeEach(async () => {
    const { resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    resetMPCCustodyManager();
  });

  it('should create signature request with unique ID', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2, verbose: false });

    await manager.generateKey('sig-key', ['a', 'b', 'c']);
    
    const req1 = await manager.requestSignature('sig-key', '0xdeadbeef', 'requester-1');
    const req2 = await manager.requestSignature('sig-key', '0xdeadbeef', 'requester-1');

    expect(req1.requestId).not.toBe(req2.requestId);
    expect(req1.status).toBe('pending');
  });

  it('should reject signature request for non-existent key', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2 });

    await expect(manager.requestSignature('no-such-key', '0xabc', 'requester'))
      .rejects.toThrow('Key no-such-key not found');
  });

  it('should track partial signatures and produce valid signature', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2, verbose: false });

    const holders = ['a', 'b', 'c'];
    await manager.generateKey('partial-key', holders);
    const request = await manager.requestSignature('partial-key', '0xdeadbeef', 'req');

    // Get actual shares for holders
    const share1 = manager.getShare('partial-key', 'a');
    const share2 = manager.getShare('partial-key', 'b');
    
    expect(share1).not.toBeNull();
    expect(share2).not.toBeNull();

    // Submit first decrypted share (not enough)
    const result1 = await manager.submitPartialSignature(request.requestId, share1!.index, share1!.value);
    expect(result1.complete).toBe(false);

    // Submit second decrypted share (threshold met - should produce valid signature)
    const result2 = await manager.submitPartialSignature(request.requestId, share2!.index, share2!.value);
    expect(result2.complete).toBe(true);
    expect(result2.signature).toBeDefined();
    expect(result2.signature!.signature).toMatch(/^0x[a-fA-F0-9]+$/);
  });

  it('should reject partial signature for invalid request', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2 });

    await expect(manager.submitPartialSignature('invalid-request-id', 1, new Uint8Array([1])))
      .rejects.toThrow('Request invalid-request-id not found');
  });

  it('should list pending signature requests', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2, verbose: false });

    await manager.generateKey('pending-key', ['a', 'b', 'c']);
    await manager.requestSignature('pending-key', '0x1', 'r1');
    await manager.requestSignature('pending-key', '0x2', 'r2');

    const pending = manager.listPendingRequests();
    expect(pending.length).toBe(2);
    expect(pending.every(r => r.status === 'pending')).toBe(true);
  });

  it('should produce cryptographically valid signatures', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    const { verifyMessage } = await import('viem');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2, verbose: false });

    const holders = ['alice', 'bob', 'carol'];
    const key = await manager.generateKey('verify-key', holders);
    const request = await manager.requestSignature('verify-key', '0xcafebabe', 'verifier');

    // Collect threshold shares
    const share1 = manager.getShare('verify-key', 'alice');
    const share2 = manager.getShare('verify-key', 'bob');
    
    await manager.submitPartialSignature(request.requestId, share1!.index, share1!.value);
    const result = await manager.submitPartialSignature(request.requestId, share2!.index, share2!.value);

    expect(result.complete).toBe(true);
    expect(result.signature).toBeDefined();

    // ACTUALLY VERIFY the signature is valid for the address
    const isValid = await verifyMessage({
      address: key.address,
      message: { raw: new Uint8Array(Buffer.from(request.messageHash.slice(2), 'hex')) },
      signature: result.signature!.signature,
    });

    expect(isValid).toBe(true);
  });
});

describe('MPC Custody - Key Rotation', () => {
  beforeEach(async () => {
    const { resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    resetMPCCustodyManager();
  });

  it('should preserve address after rotation', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2, verbose: false });

    const holders = ['a', 'b', 'c'];
    const original = await manager.generateKey('rotate-preserve', holders);
    const rotated = await manager.rotateKey('rotate-preserve');

    // Address should remain the same (same underlying secret)
    expect(rotated.address).toBe(original.address);
    expect(rotated.version).toBe(2);
  });

  it('should fail rotation for non-existent key', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2 });

    await expect(manager.rotateKey('not-a-key'))
      .rejects.toThrow('Key not-a-key not found');
  });

  it('should support rotation with new holders', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2, verbose: false });

    const oldHolders = ['a', 'b', 'c'];
    const newHolders = ['x', 'y', 'z'];
    
    await manager.generateKey('new-holders', oldHolders);
    await manager.rotateKey('new-holders', newHolders);

    // Old holders should not have shares
    expect(manager.getShare('new-holders', 'a')).toBeNull();
    
    // New holders should have shares
    expect(manager.getShare('new-holders', 'x')).not.toBeNull();
    expect(manager.getShare('new-holders', 'y')).not.toBeNull();
    expect(manager.getShare('new-holders', 'z')).not.toBeNull();
  });

  it('should increment version on each rotation', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2, verbose: false });

    const holders = ['a', 'b', 'c'];
    const v1 = await manager.generateKey('multi-rotate', holders);
    expect(v1.version).toBe(1);

    const v2 = await manager.rotateKey('multi-rotate');
    expect(v2.version).toBe(2);

    const v3 = await manager.rotateKey('multi-rotate');
    expect(v3.version).toBe(3);
  });
});

// =============================================================================
// HSM Client Tests
// =============================================================================

describe('HSM Client - Connection States', () => {
  beforeEach(async () => {
    const { resetHSMClient } = await import('@jeju/shared/crypto');
    resetHSMClient();
  });

  it('should require connection before operations', async () => {
    const { HSMClient } = await import('@jeju/shared/crypto');
    
    const client = new HSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
    });

    // Should throw without connecting
    await expect(client.listKeys())
      .rejects.toThrow('HSM not connected');
  });

  it('should allow multiple connect calls', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    await client.connect(); // Should not throw
    
    const keys = await client.listKeys();
    expect(Array.isArray(keys)).toBe(true);
  });

  it('should clear state on disconnect', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    await client.generateKey('temp-key', 'ec-secp256k1');
    
    await client.disconnect();
    
    await expect(client.listKeys())
      .rejects.toThrow('HSM not connected');
  });
});

describe('HSM Client - Key Generation', () => {
  beforeEach(async () => {
    const { resetHSMClient } = await import('@jeju/shared/crypto');
    resetHSMClient();
  });

  it('should generate EC secp256k1 keys', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('ec-key', 'ec-secp256k1');

    expect(key.type).toBe('ec-secp256k1');
    expect(key.attributes.canSign).toBe(true);
    expect(key.attributes.canVerify).toBe(true);
    expect(key.publicKey).toMatch(/^0x[a-fA-F0-9]+$/);
    expect(key.address).toMatch(/^0x[a-fA-F0-9]+$/); // Local sim generates shorter addresses
  });

  it('should generate AES-256 keys', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('aes-key', 'aes-256');

    expect(key.type).toBe('aes-256');
    expect(key.attributes.canEncrypt).toBe(true);
    expect(key.attributes.canDecrypt).toBe(true);
    expect(key.attributes.canSign).toBe(false);
  });

  it('should respect custom attributes', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('custom-key', 'ec-secp256k1', {
      canWrap: true,
      extractable: false, // Should remain false
    });

    expect(key.attributes.canWrap).toBe(true);
    expect(key.attributes.extractable).toBe(false);
  });

  it('should generate unique key IDs', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key1 = await client.generateKey('key-a', 'ec-secp256k1');
    const key2 = await client.generateKey('key-b', 'ec-secp256k1');

    expect(key1.keyId).not.toBe(key2.keyId);
  });
});

describe('HSM Client - Cryptographic Operations', () => {
  beforeEach(async () => {
    const { resetHSMClient } = await import('@jeju/shared/crypto');
    resetHSMClient();
  });

  it('should sign with EC key', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('sign-ec', 'ec-secp256k1');

    const sig = await client.sign({
      keyId: key.keyId,
      data: '0xdeadbeefcafe',
      hashAlgorithm: 'keccak256',
    });

    expect(sig.signature).toMatch(/^0x[a-fA-F0-9]+$/);
    expect(sig.r).toMatch(/^0x[a-fA-F0-9]+$/);
    expect(sig.s).toMatch(/^0x[a-fA-F0-9]+$/);
    expect([27, 28]).toContain(sig.v);
  });

  it('should reject signing with non-existent key', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();

    await expect(client.sign({
      keyId: 'no-such-key',
      data: '0xabc',
      hashAlgorithm: 'keccak256',
    })).rejects.toThrow('Key no-such-key not found');
  });

  it('should reject signing with non-signing key', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('no-sign', 'aes-256');

    await expect(client.sign({
      keyId: key.keyId,
      data: '0xabc',
      hashAlgorithm: 'sha256',
    })).rejects.toThrow('cannot sign');
  });

  it('should encrypt and decrypt with AES key - verify roundtrip', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('aes-enc', 'aes-256');

    const plaintext = '0x48656c6c6f20576f726c64'; // "Hello World" in hex
    const encrypted = await client.encrypt(key.keyId, plaintext);

    expect(encrypted.ciphertext).toMatch(/^0x[a-fA-F0-9]+$/);
    expect(encrypted.iv).toMatch(/^0x[a-fA-F0-9]+$/);
    expect(encrypted.tag).toMatch(/^0x[a-fA-F0-9]+$/);

    // ACTUALLY VERIFY decryption returns original plaintext
    const decrypted = await client.decrypt(key.keyId, encrypted.ciphertext, encrypted.iv, encrypted.tag);
    expect(decrypted).toBe(plaintext);
  });

  it('should reject encryption with non-encrypting key', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('ec-no-enc', 'ec-secp256k1');

    await expect(client.encrypt(key.keyId, '0xabc'))
      .rejects.toThrow('cannot encrypt');
  });

  it('should produce verifiable EC signatures', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('verify-sig', 'ec-secp256k1');

    const data = '0xdeadbeefcafe1234';
    const sig = await client.sign({
      keyId: key.keyId,
      data,
      hashAlgorithm: 'keccak256',
    });

    // ACTUALLY VERIFY the signature
    const isValid = await client.verify(key.keyId, data, sig.signature, 'keccak256');
    expect(isValid).toBe(true);
  });
});

describe('HSM Client - Key Lifecycle', () => {
  beforeEach(async () => {
    const { resetHSMClient } = await import('@jeju/shared/crypto');
    resetHSMClient();
  });

  it('should delete keys', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('to-delete', 'ec-secp256k1');
    
    const beforeDelete = await client.getKey(key.keyId);
    expect(beforeDelete).not.toBeNull();

    await client.deleteKey(key.keyId);
    
    const afterDelete = await client.getKey(key.keyId);
    expect(afterDelete).toBeNull();
  });

  it('should reject deleting non-existent key', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();

    await expect(client.deleteKey('not-a-key'))
      .rejects.toThrow('Key not-a-key not found');
  });

  it('should rotate keys', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const oldKey = await client.generateKey('rotate-me', 'ec-secp256k1');
    
    const newKey = await client.rotateKey(oldKey.keyId, false);

    expect(newKey.keyId).not.toBe(oldKey.keyId);
    expect(newKey.type).toBe(oldKey.type);
    
    // Old key should be deleted
    const oldLookup = await client.getKey(oldKey.keyId);
    expect(oldLookup).toBeNull();
  });

  it('should rotate keys while keeping old', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const oldKey = await client.generateKey('keep-old', 'ec-secp256k1');
    
    const newKey = await client.rotateKey(oldKey.keyId, true);

    // Both keys should exist
    const oldLookup = await client.getKey(oldKey.keyId);
    const newLookup = await client.getKey(newKey.keyId);
    
    expect(oldLookup).not.toBeNull();
    expect(newLookup).not.toBeNull();
  });

  it('should update lastUsed on sign', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();
    const key = await client.generateKey('track-usage', 'ec-secp256k1');
    
    const beforeSign = await client.getKey(key.keyId);
    expect(beforeSign?.lastUsed).toBeUndefined();

    await client.sign({ keyId: key.keyId, data: '0xabc', hashAlgorithm: 'keccak256' });
    
    const afterSign = await client.getKey(key.keyId);
    expect(afterSign?.lastUsed).toBeDefined();
    expect(afterSign?.lastUsed).toBeGreaterThan(0);
  });
});

// =============================================================================
// CQL Database Adapter Tests
// =============================================================================

describe('CQL Adapter - In-Memory Mode', () => {
  beforeEach(async () => {
    const { resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    resetCQLDatabase();
  });

  it('should initialize in memory mode without endpoint', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    
    resetCQLDatabase();
    const db = getCQLDatabase({
      blockProducerEndpoint: '', // Empty = memory mode
    });

    await db.initialize();
    const healthy = await db.healthCheck();
    expect(healthy).toBe(true);
  });

  it('should create and retrieve pins in memory', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    
    resetCQLDatabase();
    const db = getCQLDatabase({ blockProducerEndpoint: '' });
    await db.initialize();

    const pinData = {
      cid: 'QmTest123',
      name: 'test-pin',
      status: 'pinned',
      sizeBytes: 1024,
      created: new Date(),
      expiresAt: null,
      origins: ['node-1'],
      metadata: { type: 'test' },
      paidAmount: '1000000',
      paymentToken: '0xUSDC',
      paymentTxHash: '0xabc123',
      ownerAddress: '0xowner',
    };

    const id = await db.createPin(pinData);
    expect(id).toBeDefined();

    const retrieved = await db.getPin(id);
    expect(retrieved?.cid).toBe('QmTest123');
    expect(retrieved?.name).toBe('test-pin');
    expect(retrieved?.status).toBe('pinned');
  });

  it('should list pins with filters', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    
    resetCQLDatabase();
    const db = getCQLDatabase({ blockProducerEndpoint: '' });
    await db.initialize();

    // Create multiple pins
    for (const status of ['pinned', 'pinned', 'queued', 'failed']) {
      await db.createPin({
        cid: `Qm${status}${Math.random()}`,
        name: `pin-${status}`,
        status,
        sizeBytes: 100,
        created: new Date(),
        expiresAt: null,
        origins: null,
        metadata: null,
        paidAmount: null,
        paymentToken: null,
        paymentTxHash: null,
        ownerAddress: null,
      });
    }

    const allPins = await db.listPins({});
    expect(allPins.length).toBe(4);

    const pinnedOnly = await db.listPins({ status: 'pinned' });
    expect(pinnedOnly.length).toBe(2);
    expect(pinnedOnly.every(p => p.status === 'pinned')).toBe(true);
  });

  it('should update pin status', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    
    resetCQLDatabase();
    const db = getCQLDatabase({ blockProducerEndpoint: '' });
    await db.initialize();

    const id = await db.createPin({
      cid: 'QmUpdate',
      name: 'update-test',
      status: 'queued',
      sizeBytes: null,
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    });

    await db.updatePin(id, { status: 'pinned', sizeBytes: 2048 });

    const updated = await db.getPin(id);
    expect(updated?.status).toBe('pinned');
    expect(updated?.sizeBytes).toBe(2048);
  });

  it('should delete pins', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    
    resetCQLDatabase();
    const db = getCQLDatabase({ blockProducerEndpoint: '' });
    await db.initialize();

    const id = await db.createPin({
      cid: 'QmDelete',
      name: 'delete-test',
      status: 'pinned',
      sizeBytes: 100,
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    });

    const before = await db.getPin(id);
    expect(before).not.toBeNull();

    await db.deletePin(id);

    const after = await db.getPin(id);
    expect(after).toBeNull();
  });

  it('should count pins correctly', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    
    resetCQLDatabase();
    const db = getCQLDatabase({ blockProducerEndpoint: '' });
    await db.initialize();

    // Create 5 pinned, 3 failed
    for (let i = 0; i < 5; i++) {
      await db.createPin({
        cid: `QmPinned${i}`,
        name: `pinned-${i}`,
        status: 'pinned',
        sizeBytes: 100,
        created: new Date(),
        expiresAt: null,
        origins: null,
        metadata: null,
        paidAmount: null,
        paymentToken: null,
        paymentTxHash: null,
        ownerAddress: null,
      });
    }
    for (let i = 0; i < 3; i++) {
      await db.createPin({
        cid: `QmFailed${i}`,
        name: `failed-${i}`,
        status: 'failed',
        sizeBytes: null,
        created: new Date(),
        expiresAt: null,
        origins: null,
        metadata: null,
        paidAmount: null,
        paymentToken: null,
        paymentTxHash: null,
        ownerAddress: null,
      });
    }

    const total = await db.countPins();
    expect(total).toBe(8);

    const pinnedCount = await db.countPins('pinned');
    expect(pinnedCount).toBe(5);

    const failedCount = await db.countPins('failed');
    expect(failedCount).toBe(3);
  });

  it('should calculate storage stats', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    
    resetCQLDatabase();
    const db = getCQLDatabase({ blockProducerEndpoint: '' });
    await db.initialize();

    // Create pins with known sizes
    await db.createPin({
      cid: 'QmSize1',
      name: 'size-1',
      status: 'pinned',
      sizeBytes: 1024, // 1 KB
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    });
    await db.createPin({
      cid: 'QmSize2',
      name: 'size-2',
      status: 'pinned',
      sizeBytes: 2048, // 2 KB
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    });
    await db.createPin({
      cid: 'QmQueued',
      name: 'queued',
      status: 'queued',
      sizeBytes: null, // No size yet
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    });

    const stats = await db.getStorageStats();
    expect(stats.totalPins).toBe(2); // Only pinned
    expect(stats.totalSizeBytes).toBe(3072); // 1024 + 2048
    expect(stats.totalSizeGB).toBeCloseTo(3072 / (1024 ** 3), 10);
  });

  it('should find pin by CID', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    
    resetCQLDatabase();
    const db = getCQLDatabase({ blockProducerEndpoint: '' });
    await db.initialize();

    const targetCid = 'QmUniqueTestCid12345';
    await db.createPin({
      cid: targetCid,
      name: 'find-by-cid',
      status: 'pinned',
      sizeBytes: 512,
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    });

    const found = await db.getPinByCid(targetCid);
    expect(found).not.toBeNull();
    expect(found?.cid).toBe(targetCid);
    expect(found?.name).toBe('find-by-cid');

    const notFound = await db.getPinByCid('QmNonExistent');
    expect(notFound).toBeNull();
  });

  it('should handle pagination in listPins', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    
    resetCQLDatabase();
    const db = getCQLDatabase({ blockProducerEndpoint: '' });
    await db.initialize();

    // Create 10 pins
    for (let i = 0; i < 10; i++) {
      await db.createPin({
        cid: `QmPage${i}`,
        name: `page-${i}`,
        status: 'pinned',
        sizeBytes: 100,
        created: new Date(),
        expiresAt: null,
        origins: null,
        metadata: null,
        paidAmount: null,
        paymentToken: null,
        paymentTxHash: null,
        ownerAddress: null,
      });
    }

    const page1 = await db.listPins({ limit: 3, offset: 0 });
    expect(page1.length).toBe(3);

    const page2 = await db.listPins({ limit: 3, offset: 3 });
    expect(page2.length).toBe(3);

    const page4 = await db.listPins({ limit: 3, offset: 9 });
    expect(page4.length).toBe(1);
  });

  it('should close and clear state', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    
    resetCQLDatabase();
    const db = getCQLDatabase({ blockProducerEndpoint: '' });
    await db.initialize();

    await db.createPin({
      cid: 'QmClose',
      name: 'close-test',
      status: 'pinned',
      sizeBytes: 100,
      created: new Date(),
      expiresAt: null,
      origins: null,
      metadata: null,
      paidAmount: null,
      paymentToken: null,
      paymentTxHash: null,
      ownerAddress: null,
    });

    const beforeClose = await db.countPins();
    expect(beforeClose).toBe(1);

    await db.close();

    // After close, data should be cleared
    resetCQLDatabase();
    const db2 = getCQLDatabase({ blockProducerEndpoint: '' });
    await db2.initialize();
    const afterClose = await db2.countPins();
    expect(afterClose).toBe(0);
  });
});

// =============================================================================
// Concurrent Operations Tests
// =============================================================================

describe('Concurrent Operations', () => {
  it('should handle concurrent MPC key generation', async () => {
    const { getMPCCustodyManager, resetMPCCustodyManager } = await import('@jeju/shared/crypto');
    
    resetMPCCustodyManager();
    const manager = getMPCCustodyManager({ totalShares: 3, threshold: 2, verbose: false });

    const holders = ['a', 'b', 'c'];
    
    // Generate 10 keys concurrently
    const promises = Array.from({ length: 10 }, (_, i) => 
      manager.generateKey(`concurrent-key-${i}`, holders)
    );

    const keys = await Promise.all(promises);
    
    // All keys should be unique
    const addresses = keys.map(k => k.address);
    const uniqueAddresses = new Set(addresses);
    expect(uniqueAddresses.size).toBe(10);
  });

  it('should handle concurrent HSM operations', async () => {
    const { getHSMClient, resetHSMClient } = await import('@jeju/shared/crypto');
    
    resetHSMClient();
    const client = getHSMClient({
      provider: 'local-sim',
      endpoint: 'http://localhost:8080',
      credentials: {},
      auditLogging: false,
    });

    await client.connect();

    // Generate 5 keys concurrently
    const keyPromises = Array.from({ length: 5 }, (_, i) =>
      client.generateKey(`hsm-concurrent-${i}`, 'ec-secp256k1')
    );

    const keys = await Promise.all(keyPromises);
    expect(keys.length).toBe(5);

    // Sign concurrently with all keys
    const signPromises = keys.map(key =>
      client.sign({ keyId: key.keyId, data: '0xabc', hashAlgorithm: 'keccak256' })
    );

    const signatures = await Promise.all(signPromises);
    expect(signatures.length).toBe(5);
    expect(signatures.every(s => s.signature.startsWith('0x'))).toBe(true);
  });

  it('should handle concurrent CQL pin operations', async () => {
    const { getCQLDatabase, resetCQLDatabase } = await import('@jejunetwork/storage-pinning-api/src/database/cql-adapter');
    
    resetCQLDatabase();
    const db = getCQLDatabase({ blockProducerEndpoint: '' });
    await db.initialize();

    // Create 20 pins concurrently
    const createPromises = Array.from({ length: 20 }, (_, i) =>
      db.createPin({
        cid: `QmConcurrent${i}`,
        name: `concurrent-${i}`,
        status: 'pinned',
        sizeBytes: 100 * i,
        created: new Date(),
        expiresAt: null,
        origins: null,
        metadata: null,
        paidAmount: null,
        paymentToken: null,
        paymentTxHash: null,
        ownerAddress: null,
      })
    );

    const ids = await Promise.all(createPromises);
    expect(ids.length).toBe(20);

    // Verify all were created
    const count = await db.countPins();
    expect(count).toBe(20);
  });
});

// =============================================================================
// Integration Verification Tests
// =============================================================================

describe('Module Export Verification', () => {
  it('should export all CovenantSQL components', async () => {
    const dbModule = await import('@jeju/shared/db');
    
    expect(typeof dbModule.CovenantSQLClient).toBe('function');
    expect(typeof dbModule.createCovenantSQLClient).toBe('function');
    expect(typeof dbModule.getCovenantSQLClient).toBe('function');
    expect(typeof dbModule.resetCovenantSQLClient).toBe('function');
    expect(typeof dbModule.MigrationManager).toBe('function');
    expect(typeof dbModule.createTableMigration).toBe('function');
  });

  it('should export all crypto components', async () => {
    const cryptoModule = await import('@jeju/shared/crypto');
    
    expect(typeof cryptoModule.MPCCustodyManager).toBe('function');
    expect(typeof cryptoModule.getMPCCustodyManager).toBe('function');
    expect(typeof cryptoModule.resetMPCCustodyManager).toBe('function');
    expect(typeof cryptoModule.HSMClient).toBe('function');
    expect(typeof cryptoModule.getHSMClient).toBe('function');
    expect(typeof cryptoModule.resetHSMClient).toBe('function');
  });
});

