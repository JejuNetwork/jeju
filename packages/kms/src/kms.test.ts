/**
 * KMS Package Tests
 * 
 * Tests FALLBACK MODE (local AES-256-GCM encryption).
 * Lit Protocol network not connected. TEE/MPC providers are stubs.
 */

// Set required env before imports
process.env.KMS_FALLBACK_SECRET = 'test-secret-for-kms-unit-tests';

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'bun:test';
import {
  getKMS,
  resetKMS,
  KMSService,
  KMSProviderType,
  type AccessControlPolicy,
  type EncryptRequest,
  ConditionOperator,
} from './index';
import type { Address } from 'viem';

describe('KMS Service', () => {
  beforeEach(async () => {
    resetKMS();
    const kms = getKMS({
      providers: { lit: { network: 'cayenne' } },
      defaultProvider: KMSProviderType.LIT,
      defaultChain: 'base-sepolia',
      fallbackEnabled: true,
    });
    await kms.initialize();
  });

  afterEach(() => {
    resetKMS();
  });

  describe('Initialization', () => {
    it('should initialize only once (idempotent)', async () => {
      const kms = getKMS();
      await kms.initialize();
      await kms.initialize();
      await kms.initialize();
      expect(kms.getStatus().initialized).toBe(true);
    });

    it('should return same instance from getKMS', () => {
      const kms1 = getKMS();
      const kms2 = getKMS();
      expect(kms1).toBe(kms2);
    });

    it('should reset and create new instance', async () => {
      const kms1 = getKMS();
      resetKMS();
      const kms2 = getKMS();
      expect(kms1).not.toBe(kms2);
    });

    it('should auto-initialize on encrypt if not initialized', async () => {
      resetKMS();
      const kms = getKMS({ providers: { lit: { network: 'cayenne' } }, fallbackEnabled: true });
      // Not calling initialize() explicitly
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };
      const encrypted = await kms.encrypt({ data: 'test', policy });
      expect(encrypted.ciphertext).toBeDefined();
    });
  });

  describe('Encryption/Decryption', () => {
    it('should encrypt and decrypt data with time-locked policy', async () => {
      const kms = getKMS();
      const testData = JSON.stringify({ secret: 'test-secret', value: 42 });
      const now = Math.floor(Date.now() / 1000);

      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: now - 60 }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: testData, policy });
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.dataHash).toBeDefined();
      expect(encrypted.policy).toEqual(policy);

      const decrypted = await kms.decrypt({ payload: encrypted });
      expect(decrypted).toBe(testData);
    });

    it('should handle empty string encryption', async () => {
      const kms = getKMS();
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: '', policy });
      const decrypted = await kms.decrypt({ payload: encrypted });
      expect(decrypted).toBe('');
    });

    it('should handle large data (1MB)', async () => {
      const kms = getKMS();
      const largeData = 'x'.repeat(1024 * 1024); // 1MB
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: largeData, policy });
      const decrypted = await kms.decrypt({ payload: encrypted });
      expect(decrypted.length).toBe(1024 * 1024);
      expect(decrypted).toBe(largeData);
    });

    it('should handle unicode and special characters', async () => {
      const kms = getKMS();
      const unicodeData = '日本語 🚀 émojis © ® ™ "quotes" \'apostrophes\' <tags> & ampersands';
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: unicodeData, policy });
      const decrypted = await kms.decrypt({ payload: encrypted });
      expect(decrypted).toBe(unicodeData);
    });

    it('should handle binary-like data (base64)', async () => {
      const kms = getKMS();
      const binaryData = Buffer.from([0, 1, 2, 255, 254, 253]).toString('base64');
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: binaryData, policy });
      const decrypted = await kms.decrypt({ payload: encrypted });
      expect(decrypted).toBe(binaryData);
    });

    it('should preserve JSON structure exactly', async () => {
      const kms = getKMS();
      const jsonData = JSON.stringify({
        nested: { deeply: { value: [1, 2, 3] } },
        null: null,
        bool: true,
        number: 3.14159,
      });
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: jsonData, policy });
      const decrypted = await kms.decrypt({ payload: encrypted });
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(jsonData));
    });

    it('should produce different ciphertexts for same plaintext (IV uniqueness)', async () => {
      const kms = getKMS();
      const data = 'same-data';
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const encrypted1 = await kms.encrypt({ data, policy });
      const encrypted2 = await kms.encrypt({ data, policy });
      
      // Ciphertexts should differ due to random IV
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      
      // But both should decrypt to same value
      expect(await kms.decrypt({ payload: encrypted1 })).toBe(data);
      expect(await kms.decrypt({ payload: encrypted2 })).toBe(data);
    });
  });

  describe('Policy Types', () => {
    it('should encrypt with stake-gated policy', async () => {
      const kms = getKMS();
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'stake', registryAddress: '0x0000000000000000000000000000000000000001', chain: 'base-sepolia', minStakeUSD: 100 }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: 'stake-gated', policy });
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.policy.conditions[0].type).toBe('stake');
    });

    it('should encrypt with balance condition', async () => {
      const kms = getKMS();
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'balance', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: '1000000000000000000' }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: 'balance-gated', policy });
      expect(encrypted.ciphertext).toBeDefined();
    });

    it('should encrypt with role condition', async () => {
      const kms = getKMS();
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'role', registryAddress: '0x0000000000000000000000000000000000000001', chain: 'base-sepolia', role: 'ADMIN' }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: 'role-gated', policy });
      expect(encrypted.ciphertext).toBeDefined();
    });

    it('should encrypt with contract condition', async () => {
      const kms = getKMS();
      const policy: AccessControlPolicy = {
        conditions: [{
          type: 'contract',
          contractAddress: '0x0000000000000000000000000000000000000001',
          chain: 'base-sepolia',
          method: 'isAllowed',
          parameters: [':userAddress'],
          returnValueTest: { comparator: ConditionOperator.EQUALS, value: 'true' },
        }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: 'contract-gated', policy });
      expect(encrypted.ciphertext).toBeDefined();
    });

    it('should encrypt with agent condition', async () => {
      const kms = getKMS();
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'agent', registryAddress: '0x0000000000000000000000000000000000000001', chain: 'base-sepolia', agentId: 123n }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: 'agent-gated', policy });
      expect(encrypted.ciphertext).toBeDefined();
    });

    it('should handle multiple conditions with AND operator', async () => {
      const kms = getKMS();
      const policy: AccessControlPolicy = {
        conditions: [
          { type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 },
          { type: 'balance', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: '0' },
        ],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: 'multi-condition', policy });
      expect(encrypted.policy.conditions.length).toBe(2);
    });

    it('should handle multiple conditions with OR operator', async () => {
      const kms = getKMS();
      const policy: AccessControlPolicy = {
        conditions: [
          { type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 },
          { type: 'role', registryAddress: '0x0000000000000000000000000000000000000001', chain: 'base-sepolia', role: 'ADMIN' },
        ],
        operator: 'or',
      };

      const encrypted = await kms.encrypt({ data: 'or-condition', policy });
      expect(encrypted.policy.operator).toBe('or');
    });
  });

  describe('Error Handling', () => {
    it('should reject empty policy conditions', async () => {
      const kms = getKMS();
      const policy: AccessControlPolicy = { conditions: [], operator: 'and' };

      await expect(kms.generateKey('0x1234567890123456789012345678901234567890' as Address, { policy }))
        .rejects.toThrow('Access control policy must have at least one condition');
    });

    it('should reject decrypt with wrong provider type', async () => {
      const kms = getKMS();
      const fakePayload = {
        ciphertext: 'fake',
        dataHash: '0x1234' as `0x${string}`,
        accessControlHash: '0x5678' as `0x${string}`,
        policy: { conditions: [], operator: 'and' as const },
        providerType: KMSProviderType.MPC, // Not configured
        encryptedAt: Date.now(),
        keyId: 'fake-key',
      };

      await expect(kms.decrypt({ payload: fakePayload }))
        .rejects.toThrow('Provider not available: mpc');
    });

    it('should handle corrupted ciphertext gracefully', async () => {
      const kms = getKMS();
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: 'test', policy });
      
      // Corrupt the ciphertext
      const parsed = JSON.parse(encrypted.ciphertext);
      parsed.ciphertext = 'corrupted' + parsed.ciphertext;
      encrypted.ciphertext = JSON.stringify(parsed);

      await expect(kms.decrypt({ payload: encrypted })).rejects.toThrow();
    });
  });

  describe('Key Management', () => {
    it('should generate key with valid policy', async () => {
      const kms = getKMS();
      const owner = '0x1234567890123456789012345678901234567890' as Address;
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const key = await kms.generateKey(owner, { policy });
      expect(key.metadata.id).toBeDefined();
      expect(key.metadata.owner).toBe(owner);
      expect(key.publicKey).toBeDefined();
    });

    it('should retrieve generated key', async () => {
      const kms = getKMS();
      const owner = '0x1234567890123456789012345678901234567890' as Address;
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const generated = await kms.generateKey(owner, { policy });
      const retrieved = kms.getKey(generated.metadata.id);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(generated.metadata.id);
    });

    it('should return null for non-existent key', () => {
      const kms = getKMS();
      const key = kms.getKey('non-existent-key-id');
      expect(key).toBeNull();
    });

    it('should revoke key successfully', async () => {
      const kms = getKMS();
      const owner = '0x1234567890123456789012345678901234567890' as Address;
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const key = await kms.generateKey(owner, { policy });
      await kms.revokeKey(key.metadata.id);
      
      const retrieved = kms.getKey(key.metadata.id);
      expect(retrieved).toBeNull();
    });

    it('should throw when revoking non-existent key', async () => {
      const kms = getKMS();
      await expect(kms.revokeKey('non-existent')).rejects.toThrow('Key not found');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent encryptions', async () => {
      const kms = getKMS();
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const promises = Array.from({ length: 100 }, (_, i) =>
        kms.encrypt({ data: `data-${i}`, policy })
      );

      const results = await Promise.all(promises);
      
      expect(results.length).toBe(100);
      results.forEach((r, i) => {
        expect(r.ciphertext).toBeDefined();
      });

      // Verify each decrypts correctly
      const decrypted = await Promise.all(
        results.map(r => kms.decrypt({ payload: r }))
      );
      
      decrypted.forEach((d, i) => {
        expect(d).toBe(`data-${i}`);
      });
    });

    it('should handle concurrent key generation', async () => {
      const kms = getKMS();
      const owner = '0x1234567890123456789012345678901234567890' as Address;
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const promises = Array.from({ length: 50 }, () =>
        kms.generateKey(owner, { policy })
      );

      const keys = await Promise.all(promises);
      
      // All keys should be unique
      const ids = new Set(keys.map(k => k.metadata.id));
      expect(ids.size).toBe(50);
    });
  });

  describe('Status and Providers', () => {
    it('should return correct status', () => {
      const kms = getKMS();
      const status = kms.getStatus();

      expect(status.initialized).toBe(true);
      expect(status.defaultProvider).toBe(KMSProviderType.LIT);
      expect(status.providers).toBeDefined();
      expect(status.providers[KMSProviderType.LIT]).toBeDefined();
    });

    it('should show fallback mode when Lit not connected', () => {
      const kms = getKMS();
      const status = kms.getStatus();
      
      // In test environment, Lit won't be connected
      const litStatus = status.providers[KMSProviderType.LIT];
      expect(litStatus).toBeDefined();
      expect(litStatus.status).toHaveProperty('fallbackMode');
    });
  });
});

describe('SDK Functions', () => {
  beforeEach(async () => {
    resetKMS();
    await getKMS({ providers: { lit: { network: 'cayenne' } }, fallbackEnabled: true }).initialize();
  });

  afterEach(() => resetKMS());

  it('should create time-locked policy with future timestamp', async () => {
    const { timeLockedPolicy } = await import('./sdk/encrypt');
    const futureTime = Math.floor(Date.now() / 1000) + 3600;
    
    const policy = timeLockedPolicy('base-sepolia', futureTime);
    
    expect(policy.conditions).toHaveLength(1);
    expect(policy.conditions[0].type).toBe('timestamp');
    expect((policy.conditions[0] as { value: number }).value).toBe(futureTime);
    expect(policy.operator).toBe('and');
  });

  it('should create time-locked policy with past timestamp (already unlocked)', async () => {
    const { timeLockedPolicy } = await import('./sdk/encrypt');
    const pastTime = Math.floor(Date.now() / 1000) - 3600;
    
    const policy = timeLockedPolicy('base-sepolia', pastTime);
    expect((policy.conditions[0] as { value: number }).value).toBe(pastTime);
  });

  it('should create stake-gated policy with minimum stake', async () => {
    const { stakeGatedPolicy } = await import('./sdk/encrypt');
    
    const policy = stakeGatedPolicy(
      '0x0000000000000000000000000000000000000001',
      'base-sepolia',
      1000
    );
    
    expect(policy.conditions).toHaveLength(1);
    expect(policy.conditions[0].type).toBe('stake');
    expect((policy.conditions[0] as { minStakeUSD: number }).minStakeUSD).toBe(1000);
  });

  it('should create stake-gated policy with zero minimum', async () => {
    const { stakeGatedPolicy } = await import('./sdk/encrypt');
    
    const policy = stakeGatedPolicy(
      '0x0000000000000000000000000000000000000001',
      'base-sepolia',
      0
    );
    
    expect((policy.conditions[0] as { minStakeUSD: number }).minStakeUSD).toBe(0);
  });

  it('should create role-gated policy', async () => {
    const { roleGatedPolicy } = await import('./sdk/encrypt');
    
    const policy = roleGatedPolicy(
      '0x0000000000000000000000000000000000000001',
      'base-sepolia',
      'ADMIN'
    );
    
    expect(policy.conditions).toHaveLength(1);
    expect(policy.conditions[0].type).toBe('role');
    expect((policy.conditions[0] as { role: string }).role).toBe('ADMIN');
  });

  it('should create role-gated policy with custom role name', async () => {
    const { roleGatedPolicy } = await import('./sdk/encrypt');
    
    const policy = roleGatedPolicy(
      '0x0000000000000000000000000000000000000001',
      'mainnet',
      'CUSTOM_ROLE_123'
    );
    
    expect((policy.conditions[0] as { role: string }).role).toBe('CUSTOM_ROLE_123');
    expect((policy.conditions[0] as { chain: string }).chain).toBe('mainnet');
  });
});

describe('Edge Cases', () => {
  beforeEach(async () => {
    resetKMS();
    await getKMS({ providers: { lit: { network: 'cayenne' } }, fallbackEnabled: true }).initialize();
  });

  afterEach(() => resetKMS());

  it('should handle very long key IDs', async () => {
    const kms = getKMS();
    const owner = '0x1234567890123456789012345678901234567890' as Address;
    const policy: AccessControlPolicy = {
      conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
      operator: 'and',
    };

    const key = await kms.generateKey(owner, { policy });
    expect(key.metadata.id.length).toBeGreaterThan(0);
    expect(key.metadata.id.length).toBeLessThan(100); // Reasonable length
  });

  it('should handle metadata in encrypt request', async () => {
    const kms = getKMS();
    const policy: AccessControlPolicy = {
      conditions: [{ type: 'timestamp', chain: 'base-sepolia', comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
      operator: 'and',
    };

    const encrypted = await kms.encrypt({
      data: 'test',
      policy,
      metadata: { custom: 'metadata', purpose: 'testing' },
    });

    expect(encrypted.metadata).toBeDefined();
    expect(encrypted.metadata!.custom).toBe('metadata');
    expect(encrypted.metadata!.purpose).toBe('testing');
  });

  it('should handle chain parameter variations', async () => {
    const kms = getKMS();
    const chains = ['ethereum', 'base', 'base-sepolia', 'polygon', 'arbitrum'];
    
    for (const chain of chains) {
      const policy: AccessControlPolicy = {
        conditions: [{ type: 'timestamp', chain, comparator: ConditionOperator.GREATER_THAN_OR_EQUAL, value: 0 }],
        operator: 'and',
      };

      const encrypted = await kms.encrypt({ data: `test-${chain}`, policy });
      expect(encrypted.ciphertext).toBeDefined();
    }
  });
});
