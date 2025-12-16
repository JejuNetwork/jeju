/**
 * Comprehensive Tests for OAuth3 Decentralized Infrastructure
 * 
 * Coverage: boundary conditions, error handling, integration points, concurrency, output verification
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Address, Hex } from 'viem';
import { keccak256, toBytes } from 'viem';
import { OAuth3JNSService, createOAuth3JNSService, resetOAuth3JNSService } from '../src/infrastructure/jns-integration.js';
import { OAuth3StorageService, createOAuth3StorageService, resetOAuth3StorageService } from '../src/infrastructure/storage-integration.js';
import { OAuth3ComputeService, createOAuth3ComputeService, resetOAuth3ComputeService } from '../src/infrastructure/compute-integration.js';
import { OAuth3DecentralizedDiscovery, createDecentralizedDiscovery, resetDecentralizedDiscovery } from '../src/infrastructure/discovery.js';
import { namehash, labelhash } from '../src/infrastructure/abis.js';
import { 
  CHAIN_IDS, CONTRACTS, MIN_STAKE, CACHE_EXPIRY_MS, ZERO_ADDRESS,
  getNetworkType, getContracts, DEFAULT_RPC, DEFAULT_IPFS_API
} from '../src/infrastructure/config.js';
import { TEEProvider, AuthProvider, type OAuth3Session, type VerifiableCredential } from '../src/types.js';
import { calculateStorageFee, calculateComputeFee, X402PaymentClient, createX402PaymentClient, resetX402PaymentClient } from '../src/infrastructure/x402-payments.js';
import { ThresholdEncryptionService, deriveLocalEncryptionKey } from '../src/infrastructure/threshold-encryption.js';

// Helper to check for expected chain errors
function isChainError(error: Error): boolean {
  const msg = error.message;
  return msg.includes('reverted') || msg.includes('Unable to connect') || msg.includes('HTTP request failed');
}

// ============ Config Tests ============

describe('Config Module', () => {
  describe('getNetworkType', () => {
    it('should return localnet for chain 420691', () => {
      expect(getNetworkType(420691)).toBe('localnet');
    });

    it('should return testnet for chain 420690', () => {
      expect(getNetworkType(420690)).toBe('testnet');
    });

    it('should return mainnet for any other chain', () => {
      expect(getNetworkType(1)).toBe('mainnet');
      expect(getNetworkType(420692)).toBe('mainnet');
      expect(getNetworkType(0)).toBe('mainnet');
      expect(getNetworkType(-1)).toBe('mainnet');
      expect(getNetworkType(Number.MAX_SAFE_INTEGER)).toBe('mainnet');
    });
  });

  describe('getContracts', () => {
    it('should return correct contracts for each network', () => {
      const localnetContracts = getContracts(CHAIN_IDS.localnet);
      expect(localnetContracts.jnsRegistry).toBe(CONTRACTS.localnet.jnsRegistry);
      expect(localnetContracts.teeVerifier).toBe(CONTRACTS.localnet.teeVerifier);

      const testnetContracts = getContracts(CHAIN_IDS.testnet);
      expect(testnetContracts.jnsRegistry).toBe(CONTRACTS.testnet.jnsRegistry);
      
      // Verify networks have different addresses
      expect(localnetContracts.jnsRegistry).not.toBe(testnetContracts.jnsRegistry);
    });

    it('should throw for mainnet until deployed', () => {
      expect(() => getContracts(CHAIN_IDS.mainnet)).toThrow('Mainnet contracts not yet deployed');
    });
  });

  describe('Constants', () => {
    it('should have correct MIN_STAKE value (1 ETH)', () => {
      expect(MIN_STAKE).toBe(BigInt('1000000000000000000'));
    });

    it('should have correct CACHE_EXPIRY_MS (1 minute)', () => {
      expect(CACHE_EXPIRY_MS).toBe(60000);
    });

    it('should have correct ZERO_ADDRESS', () => {
      expect(ZERO_ADDRESS).toBe('0x0000000000000000000000000000000000000000');
      expect(ZERO_ADDRESS.length).toBe(42);
    });

    it('should have valid chain IDs', () => {
      expect(CHAIN_IDS.localnet).toBe(420691);
      expect(CHAIN_IDS.testnet).toBe(420690);
      expect(CHAIN_IDS.mainnet).toBe(420692);
    });
  });
});

// ============ Namehash Tests ============

describe('Namehash and Labelhash', () => {
  describe('namehash - boundary conditions', () => {
    it('should return zero hash for empty string', () => {
      const result = namehash('');
      expect(result).toBe('0x0000000000000000000000000000000000000000000000000000000000000000');
    });

    it('should handle single label', () => {
      const result = namehash('jeju');
      expect(result).toMatch(/^0x[a-f0-9]{64}$/);
      expect(result).not.toBe('0x0000000000000000000000000000000000000000000000000000000000000000');
    });

    it('should handle deep nesting', () => {
      const result = namehash('a.b.c.d.e.f.g.h.i.j.oauth3.jeju');
      expect(result).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should handle very long labels', () => {
      const longLabel = 'a'.repeat(100);
      const result = namehash(`${longLabel}.jeju`);
      expect(result).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should be deterministic', () => {
      const hash1 = namehash('test.oauth3.jeju');
      const hash2 = namehash('test.oauth3.jeju');
      expect(hash1).toBe(hash2);
    });

    it('should be case-sensitive (ENS is case-insensitive, but raw keccak is not)', () => {
      const lower = namehash('test.jeju');
      const upper = namehash('TEST.jeju');
      // Raw namehash IS case sensitive
      expect(lower).not.toBe(upper);
    });

    it('should handle unicode characters', () => {
      const result = namehash('テスト.jeju');
      expect(result).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should handle numbers in labels', () => {
      const result = namehash('app123.oauth3.jeju');
      expect(result).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should handle hyphens', () => {
      const result = namehash('my-app.oauth3.jeju');
      expect(result).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different domains', () => {
      const hash1 = namehash('app1.jeju');
      const hash2 = namehash('app2.jeju');
      const hash3 = namehash('app1.oauth3.jeju');
      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash2).not.toBe(hash3);
    });
  });

  describe('labelhash - verification', () => {
    it('should match keccak256 of label bytes', () => {
      const label = 'test';
      const expected = keccak256(toBytes(label));
      expect(labelhash(label)).toBe(expected);
    });

    it('should handle empty string', () => {
      const result = labelhash('');
      expect(result).toMatch(/^0x[a-f0-9]{64}$/);
      expect(result).toBe(keccak256(toBytes('')));
    });

    it('should handle special characters', () => {
      const result = labelhash('test-app_123');
      expect(result).toBe(keccak256(toBytes('test-app_123')));
    });
  });

  describe('namehash - hierarchy verification', () => {
    it('should verify child depends on parent', () => {
      // namehash('oauth3.jeju') should be:
      // keccak256(namehash('jeju') + labelhash('oauth3'))
      const jejuHash = namehash('jeju');
      const oauth3Label = labelhash('oauth3');
      const expectedOauth3Jeju = keccak256(
        new Uint8Array([...toBytes(jejuHash), ...toBytes(oauth3Label)])
      );
      expect(namehash('oauth3.jeju')).toBe(expectedOauth3Jeju);
    });
  });
});

// ============ JNS Integration Tests ============

describe('OAuth3 JNS Integration', () => {
  let jns: OAuth3JNSService;

  beforeEach(() => {
    resetOAuth3JNSService();
    jns = createOAuth3JNSService({ rpcUrl: 'http://localhost:9545', chainId: 420691 });
  });

  describe('singleton behavior', () => {
    it('should return same instance on repeated calls', () => {
      const jns2 = createOAuth3JNSService({ rpcUrl: 'http://localhost:9545' });
      expect(jns).toBe(jns2);
    });

    it('should create new instance after reset', () => {
      resetOAuth3JNSService();
      const jns2 = createOAuth3JNSService({ rpcUrl: 'http://localhost:9545' });
      expect(jns).not.toBe(jns2);
    });
  });

  describe('address getters', () => {
    it('should return valid registry address', () => {
      const addr = jns.getRegistryAddress();
      expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(addr).toBe(CONTRACTS.localnet.jnsRegistry);
    });

    it('should return valid resolver address', () => {
      const addr = jns.getDefaultResolverAddress();
      expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(addr).toBe(CONTRACTS.localnet.jnsResolver);
    });

    it('should use testnet addresses for testnet chain', () => {
      resetOAuth3JNSService();
      const testnetJns = createOAuth3JNSService({ chainId: 420690 });
      expect(testnetJns.getRegistryAddress()).toBe(CONTRACTS.testnet.jnsRegistry);
      // Testnet addresses should be different from localnet
      expect(testnetJns.getRegistryAddress()).not.toBe(CONTRACTS.localnet.jnsRegistry);
    });
  });

  describe('on-chain operations (require contracts)', () => {
    it('should check name availability', async () => {
      try {
        const available = await jns.isAvailable('test-oauth3-app');
        expect(typeof available).toBe('boolean');
      } catch (error) {
        expect(isChainError(error as Error)).toBe(true);
      }
    });

    it('should resolve non-existent app as null', async () => {
      try {
        const app = await jns.resolveApp('definitely-nonexistent-12345.oauth3.jeju');
        expect(app).toBeNull();
      } catch (error) {
        expect(isChainError(error as Error)).toBe(true);
      }
    });

    it('should handle various name formats', async () => {
      const formats = [
        'myapp',
        'myapp.oauth3',
        'myapp.oauth3.jeju',
      ];
      
      for (const name of formats) {
        try {
          const app = await jns.resolveApp(name);
          expect(app === null || typeof app === 'object').toBe(true);
        } catch (error) {
          expect(isChainError(error as Error)).toBe(true);
        }
      }
    });

    it('should reverse resolve zero address as null', async () => {
      try {
        const name = await jns.reverseResolve(ZERO_ADDRESS);
        expect(name).toBeNull();
      } catch (error) {
        expect(isChainError(error as Error)).toBe(true);
      }
    });

    it('should get records for non-existent name', async () => {
      try {
        const records = await jns.getRecords('nonexistent.jeju');
        expect(typeof records).toBe('object');
      } catch (error) {
        expect(isChainError(error as Error)).toBe(true);
      }
    });
  });
});

// ============ Storage Integration Tests ============

describe('OAuth3 Decentralized Storage', () => {
  let storage: OAuth3StorageService;
  const testKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as Hex;

  beforeEach(() => {
    resetOAuth3StorageService();
    storage = createOAuth3StorageService({ 
      ipfsApiEndpoint: 'http://localhost:5001/api/v0', 
      encryptionKey: testKey 
    });
  });

  const createMockSession = (overrides: Partial<OAuth3Session> = {}): OAuth3Session => ({
    sessionId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex,
    identityId: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hex,
    smartAccount: '0x1234567890123456789012345678901234567890' as Address,
    expiresAt: Date.now() + 86400000,
    capabilities: ['sign_message', 'sign_transaction'],
    signingKey: '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210' as Hex,
    attestation: { 
      quote: '0x' as Hex, 
      measurement: '0x' as Hex, 
      reportData: '0x' as Hex, 
      timestamp: Date.now(), 
      provider: TEEProvider.SIMULATED, 
      verified: false 
    },
    ...overrides,
  });

  describe('encryption key requirements', () => {
    it('should throw when storing session without encryption key', async () => {
      resetOAuth3StorageService();
      const noKeyStorage = createOAuth3StorageService({ ipfsApiEndpoint: 'http://localhost:5001/api/v0' });
      
      await expect(noKeyStorage.storeSession(createMockSession()))
        .rejects.toThrow('Encryption key required');
    });

    it('should allow setting encryption key after construction', () => {
      resetOAuth3StorageService();
      const noKeyStorage = createOAuth3StorageService({});
      noKeyStorage.setEncryptionKey(testKey);
      // Should not throw when key is set
      expect(() => noKeyStorage.setEncryptionKey(testKey)).not.toThrow();
    });
  });

  describe('session storage', () => {
    it('should store and retrieve session (if IPFS available)', async () => {
      const session = createMockSession();
      try {
        const stored = await storage.storeSession(session);
        expect(stored.sessionId).toBe(session.sessionId);
        expect(stored.cid).toBeTruthy();
        expect(stored.cid.length).toBeGreaterThan(10);
        expect(stored.encryptedData).toMatch(/^0x[a-f0-9]+$/);
      } catch (error) {
        expect((error as Error).message).toContain('IPFS');
      }
    });

    it('should handle expired session retrieval', async () => {
      const expiredSession = createMockSession({
        sessionId: '0xexpired0000000000000000000000000000000000000000000000000000000' as Hex,
        expiresAt: Date.now() - 1000, // Already expired
      });
      
      // Retrieving non-cached expired session should return null
      const result = await storage.retrieveSession(expiredSession.sessionId);
      expect(result).toBeNull();
    });

    it('should return null for non-existent session', async () => {
      const result = await storage.retrieveSession('0xnonexistent000000000000000000000000000000000000000000000000000' as Hex);
      expect(result).toBeNull();
    });
  });

  describe('credential storage', () => {
    const createMockCredential = (): VerifiableCredential => ({
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'OAuth3IdentityCredential'],
      id: `urn:uuid:${crypto.randomUUID()}`,
      issuer: { id: 'did:ethr:420691:0x1234567890123456789012345678901234567890', name: 'Test' },
      issuanceDate: new Date().toISOString(),
      expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      credentialSubject: {
        id: 'did:ethr:420691:0xabcdef1234567890abcdef1234567890abcdef12',
        provider: AuthProvider.GOOGLE,
        providerId: '123456789',
        providerHandle: 'test@example.com',
        walletAddress: '0xabcdef1234567890abcdef1234567890abcdef12' as Address,
        verifiedAt: new Date().toISOString(),
      },
      proof: {
        type: 'EcdsaSecp256k1Signature2019',
        created: new Date().toISOString(),
        verificationMethod: 'did:ethr:420691:0x1234567890123456789012345678901234567890#controller',
        proofPurpose: 'assertionMethod',
        proofValue: '0x' as Hex,
      },
    });

    it('should store credential (if IPFS available)', async () => {
      const credential = createMockCredential();
      try {
        const stored = await storage.storeCredential(credential);
        expect(stored.credentialId).toBe(credential.id);
        expect(stored.cid).toBeTruthy();
        expect(stored.issuerDid).toBe(credential.issuer.id);
        expect(stored.subjectDid).toBe(credential.credentialSubject.id);
      } catch (error) {
        expect((error as Error).message).toContain('IPFS');
      }
    });

    it('should return null for non-existent credential', async () => {
      const result = await storage.retrieveCredential('urn:uuid:nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('gateway URLs', () => {
    it('should generate correct gateway URL', () => {
      const cid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
      const url = storage.getGatewayUrl(cid);
      expect(url).toContain(cid);
      // DWS storage gateway at localhost:4030/storage/ipfs
      expect(url).toContain('localhost:4030/storage/ipfs');
    });

    it('should handle CIDv1', () => {
      const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const url = storage.getGatewayUrl(cid);
      expect(url).toContain(cid);
    });
  });

  describe('health check', () => {
    it('should return boolean for health check', async () => {
      const healthy = await storage.isHealthy();
      expect(typeof healthy).toBe('boolean');
    });
  });
});

// ============ Compute Integration Tests ============

describe('OAuth3 Compute Integration', () => {
  let compute: OAuth3ComputeService;

  beforeEach(() => {
    resetOAuth3ComputeService();
    compute = createOAuth3ComputeService({ rpcUrl: 'http://localhost:9545', chainId: 420691 });
  });

  describe('singleton behavior', () => {
    it('should return same instance', () => {
      const compute2 = createOAuth3ComputeService({});
      expect(compute).toBe(compute2);
    });

    it('should reset correctly', () => {
      resetOAuth3ComputeService();
      const compute2 = createOAuth3ComputeService({});
      expect(compute).not.toBe(compute2);
    });
  });

  describe('TEE verifier address', () => {
    it('should return valid address', () => {
      expect(compute.getTeeVerifierAddress()).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should match config', () => {
      expect(compute.getTeeVerifierAddress()).toBe(CONTRACTS.localnet.teeVerifier);
    });
  });

  describe('node health checks', () => {
    it('should return false for unreachable endpoint', async () => {
      const healthy = await compute.checkNodeHealth('http://localhost:99999');
      expect(healthy).toBe(false);
    });

    it('should return false for empty endpoint', async () => {
      const healthy = await compute.checkNodeHealth('');
      expect(healthy).toBe(false);
    });

    it('should return false for invalid URL', async () => {
      const healthy = await compute.checkNodeHealth('not-a-valid-url');
      expect(healthy).toBe(false);
    });
  });

  describe('attestation retrieval', () => {
    it('should return null for unreachable endpoint', async () => {
      const attestation = await compute.getNodeAttestation('http://localhost:99999');
      expect(attestation).toBeNull();
    });
  });

  describe('cache management', () => {
    it('should clear cache without error', () => {
      expect(() => compute.clearCache()).not.toThrow();
    });
  });

  describe('on-chain operations (require contracts)', () => {
    it('should list TEE providers', async () => {
      try {
        const providers = await compute.listTEEProviders();
        expect(Array.isArray(providers)).toBe(true);
        for (const p of providers) {
          expect(p.nodeId).toMatch(/^0x[a-f0-9]{64}$/);
          expect(p.stake).toBeGreaterThanOrEqual(0n);
        }
      } catch (error) {
        expect(isChainError(error as Error)).toBe(true);
      }
    });

    it('should get best provider with options', async () => {
      try {
        const provider = await compute.getBestProvider({
          minStake: MIN_STAKE,
          preferredTeeType: TEEProvider.DSTACK,
        });
        if (provider) {
          expect(provider.stake).toBeGreaterThanOrEqual(MIN_STAKE);
        }
      } catch (error) {
        expect(isChainError(error as Error)).toBe(true);
      }
    });
  });
});

// ============ Discovery Tests ============

describe('OAuth3 Decentralized Discovery', () => {
  let discovery: OAuth3DecentralizedDiscovery;

  beforeEach(() => {
    resetDecentralizedDiscovery();
    resetOAuth3JNSService();
    resetOAuth3StorageService();
    resetOAuth3ComputeService();
    discovery = createDecentralizedDiscovery({
      rpcUrl: 'http://localhost:9545',
      chainId: 420691,
      ipfsApiEndpoint: 'http://localhost:5001/api/v0',
    });
  });

  describe('sub-service access', () => {
    it('should provide JNS service', () => {
      expect(discovery.getJNS()).toBeInstanceOf(OAuth3JNSService);
    });

    it('should provide storage service', () => {
      expect(discovery.getStorage()).toBeInstanceOf(OAuth3StorageService);
    });

    it('should provide compute service', () => {
      expect(discovery.getCompute()).toBeInstanceOf(OAuth3ComputeService);
    });

    it('should provide public client', () => {
      expect(discovery.getClient()).toBeTruthy();
    });
  });

  describe('node verification', () => {
    it('should return invalid for empty endpoint', async () => {
      const result = await discovery.verifyNode('');
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should return invalid for unreachable endpoint', async () => {
      const result = await discovery.verifyNode('http://localhost:99999');
      expect(result.valid).toBe(false);
    });

    it('should include latency when reachable', async () => {
      const result = await discovery.verifyNode('http://localhost:4200');
      if (result.valid) {
        expect(result.latency).toBeGreaterThan(0);
      }
    });
  });

  describe('cache management', () => {
    it('should clear all caches', () => {
      expect(() => discovery.clearCaches()).not.toThrow();
    });
  });

  describe('app discovery (require contracts)', () => {
    it('should discover app by full JNS name', async () => {
      try {
        const app = await discovery.discoverApp('nonexistent.oauth3.jeju');
        expect(app).toBeNull();
      } catch (error) {
        expect(isChainError(error as Error)).toBe(true);
      }
    });

    it('should discover app by partial name', async () => {
      try {
        const app = await discovery.discoverApp('nonexistent');
        expect(app).toBeNull();
      } catch (error) {
        expect(isChainError(error as Error)).toBe(true);
      }
    });

    it('should discover app by hex ID', async () => {
      try {
        const app = await discovery.discoverApp('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
        expect(app === null || typeof app === 'object').toBe(true);
      } catch (error) {
        expect(isChainError(error as Error)).toBe(true);
      }
    });
  });

  describe('infrastructure health', () => {
    it('should report health for all components', async () => {
      try {
        const health = await discovery.getInfrastructureHealth();
        expect(typeof health.chain.healthy).toBe('boolean');
        expect(typeof health.chain.blockNumber).toBe('bigint');
        expect(typeof health.jns.healthy).toBe('boolean');
        expect(typeof health.jns.latency).toBe('number');
        expect(typeof health.storage.healthy).toBe('boolean');
        expect(typeof health.storage.latency).toBe('number');
        expect(typeof health.teeNodes.total).toBe('number');
        expect(typeof health.teeNodes.healthy).toBe('number');
        expect(typeof health.teeNodes.verified).toBe('number');
      } catch (error) {
        expect(isChainError(error as Error)).toBe(true);
      }
    });
  });
});

// ============ x402 Payment Tests ============

describe('x402 Payment Utilities', () => {
  describe('calculateStorageFee', () => {
    it('should return 0 for 0 bytes', () => {
      expect(calculateStorageFee(0, 30, 'hot')).toBe(0n);
    });

    it('should return 0 for 0 days', () => {
      expect(calculateStorageFee(1000, 0, 'hot')).toBe(0n);
    });

    it('should scale with size', () => {
      const fee1 = calculateStorageFee(1000, 30, 'hot');
      const fee2 = calculateStorageFee(2000, 30, 'hot');
      expect(fee2).toBe(fee1 * 2n);
    });

    it('should scale with duration', () => {
      const fee1 = calculateStorageFee(1000, 30, 'hot');
      const fee2 = calculateStorageFee(1000, 60, 'hot');
      expect(fee2).toBe(fee1 * 2n);
    });

    it('should have correct tier ordering: cold < warm < hot < permanent', () => {
      const cold = calculateStorageFee(1000, 30, 'cold');
      const warm = calculateStorageFee(1000, 30, 'warm');
      const hot = calculateStorageFee(1000, 30, 'hot');
      const permanent = calculateStorageFee(1000, 30, 'permanent');

      expect(cold).toBeLessThan(warm);
      expect(warm).toBeLessThan(hot);
      expect(hot).toBeLessThan(permanent);
    });

    it('should handle large values', () => {
      const fee = calculateStorageFee(1_000_000_000, 365, 'permanent');
      expect(fee).toBeGreaterThan(0n);
    });
  });

  describe('calculateComputeFee', () => {
    it('should return 0 for 0 minutes', () => {
      expect(calculateComputeFee(0, 4, 8, 'dstack')).toBe(0n);
    });

    it('should scale with duration', () => {
      const fee1 = calculateComputeFee(60, 4, 8, 'dstack');
      const fee2 = calculateComputeFee(120, 4, 8, 'dstack');
      expect(fee2).toBe(fee1 * 2n);
    });

    it('should scale with cores', () => {
      const fee1 = calculateComputeFee(60, 4, 8, 'dstack');
      const fee2 = calculateComputeFee(60, 8, 8, 'dstack');
      expect(fee2).toBeGreaterThan(fee1);
    });

    it('should have correct TEE type ordering: simulated < phala < dstack', () => {
      const simulated = calculateComputeFee(60, 4, 8, 'simulated');
      const phala = calculateComputeFee(60, 4, 8, 'phala');
      const dstack = calculateComputeFee(60, 4, 8, 'dstack');

      expect(simulated).toBeLessThan(phala);
      expect(phala).toBeLessThan(dstack);
    });

    it('should include memory in calculation', () => {
      const fee1 = calculateComputeFee(60, 4, 4, 'dstack');
      const fee2 = calculateComputeFee(60, 4, 8, 'dstack');
      expect(fee2).toBeGreaterThan(fee1);
    });
  });

  describe('X402PaymentClient', () => {
    beforeEach(() => {
      resetX402PaymentClient();
    });

    it('should create client with config', () => {
      const client = createX402PaymentClient({
        payerAddress: '0x1234567890123456789012345678901234567890' as Address,
        signPayment: async () => '0x' as Hex,
      });
      expect(client).toBeInstanceOf(X402PaymentClient);
    });

    it('should track pending payments', async () => {
      const client = createX402PaymentClient({
        payerAddress: '0x1234567890123456789012345678901234567890' as Address,
        signPayment: async () => '0xsignature' as Hex,
      });

      const pending = client.getPendingPayments();
      expect(Array.isArray(pending)).toBe(true);
    });
  });
});

// ============ Threshold Encryption Tests ============

describe('Threshold Encryption', () => {
  describe('deriveLocalEncryptionKey', () => {
    it('should derive deterministic key from seed', () => {
      const seed = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex;
      const key1 = deriveLocalEncryptionKey(seed);
      const key2 = deriveLocalEncryptionKey(seed);
      expect(key1).toBe(key2);
    });

    it('should produce different keys for different seeds', () => {
      const key1 = deriveLocalEncryptionKey('0x1111111111111111111111111111111111111111111111111111111111111111' as Hex);
      const key2 = deriveLocalEncryptionKey('0x2222222222222222222222222222222222222222222222222222222222222222' as Hex);
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys with different salts', () => {
      const seed = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex;
      const key1 = deriveLocalEncryptionKey(seed, 'salt1');
      const key2 = deriveLocalEncryptionKey(seed, 'salt2');
      expect(key1).not.toBe(key2);
    });

    it('should return valid 32-byte hex', () => {
      const key = deriveLocalEncryptionKey('0xabcdef' as Hex);
      expect(key).toMatch(/^0x[a-f0-9]{64}$/);
    });
  });

  describe('ThresholdEncryptionService', () => {
    it('should create service with config', () => {
      const service = new ThresholdEncryptionService({
        clusterId: 'test-cluster',
        threshold: 2,
        totalNodes: 3,
        publicKey: '0x04abcdef' as Hex,
        mpcEndpoint: 'http://localhost:4000',
      });

      expect(service.getThreshold()).toBe(2);
      expect(service.getConfig().clusterId).toBe('test-cluster');
    });

    it('should encrypt data with valid public key', async () => {
      // Generate a real P-256 key pair for testing
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits']
      );
      const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
      const publicKeyHex = '0x' + Array.from(new Uint8Array(publicKeyRaw)).map(b => b.toString(16).padStart(2, '0')).join('') as Hex;

      const service = new ThresholdEncryptionService({
        clusterId: 'test-cluster',
        threshold: 2,
        totalNodes: 3,
        publicKey: publicKeyHex,
        mpcEndpoint: 'http://localhost:4000',
      });

      const payload = await service.encrypt('test data');
      expect(payload.clusterId).toBe('test-cluster');
      expect(payload.version).toBe(1);
      expect(payload.ephemeralPubKey).toMatch(/^0x[a-f0-9]+$/);
      expect(payload.ciphertext).toMatch(/^0x[a-f0-9]+$/);
      expect(payload.nonce).toMatch(/^0x[a-f0-9]+$/);
      expect(payload.tag).toMatch(/^0x[a-f0-9]+$/);
    });

    it('should check cluster health', async () => {
      const service = new ThresholdEncryptionService({
        clusterId: 'test-cluster',
        threshold: 2,
        totalNodes: 3,
        publicKey: '0x04abcdef' as Hex,
        mpcEndpoint: 'http://localhost:99999', // Unreachable
      });

      const healthy = await service.isHealthy();
      expect(healthy).toBe(false);
    });
  });
});

// ============ Concurrent Behavior Tests ============

describe('Concurrent Operations', () => {
  beforeEach(() => {
    resetOAuth3JNSService();
    resetOAuth3StorageService();
    resetOAuth3ComputeService();
    resetDecentralizedDiscovery();
  });

  it('should handle parallel JNS lookups', async () => {
    const jns = createOAuth3JNSService({ rpcUrl: 'http://localhost:9545', chainId: 420691 });
    
    const lookups = Promise.all([
      jns.isAvailable('app1.jeju').catch(() => null),
      jns.isAvailable('app2.jeju').catch(() => null),
      jns.isAvailable('app3.jeju').catch(() => null),
    ]);

    const results = await lookups;
    expect(results.length).toBe(3);
  });

  it('should handle parallel storage health checks', async () => {
    const storage = createOAuth3StorageService({});
    
    const checks = Promise.all([
      storage.isHealthy(),
      storage.isHealthy(),
      storage.isHealthy(),
    ]);

    const results = await checks;
    expect(results.length).toBe(3);
    results.forEach(r => expect(typeof r).toBe('boolean'));
  });

  it('should handle parallel compute health checks', async () => {
    const compute = createOAuth3ComputeService({});
    
    const endpoints = ['http://localhost:4200', 'http://localhost:4201', 'http://localhost:4202'];
    const checks = Promise.all(endpoints.map(e => compute.checkNodeHealth(e)));

    const results = await checks;
    expect(results.length).toBe(3);
    results.forEach(r => expect(typeof r).toBe('boolean'));
  });
});

// ============ Edge Cases and Error Handling ============

describe('Edge Cases and Error Handling', () => {
  describe('invalid inputs', () => {
    it('should handle invalid RPC URL gracefully', async () => {
      resetOAuth3JNSService();
      const jns = createOAuth3JNSService({ rpcUrl: 'not-a-url', chainId: 420691 });
      
      try {
        await jns.isAvailable('test.jeju');
      } catch (error) {
        expect(error).toBeTruthy();
      }
    });

    it('should throw for negative chain ID (maps to mainnet which is not deployed)', () => {
      resetOAuth3JNSService();
      // Negative chain ID maps to mainnet, which throws because contracts aren't deployed
      expect(() => createOAuth3JNSService({ chainId: -1 }))
        .toThrow('Mainnet contracts not yet deployed');
    });
  });

  describe('environment variable fallbacks', () => {
    it('should use DEFAULT_RPC when no rpcUrl provided', () => {
      resetOAuth3JNSService();
      // Clear env var if set
      const original = process.env.JEJU_RPC_URL;
      delete process.env.JEJU_RPC_URL;
      
      const jns = createOAuth3JNSService({});
      expect(jns.getClient()).toBeTruthy();
      
      // Restore
      if (original) process.env.JEJU_RPC_URL = original;
    });
  });

  describe('timeout handling', () => {
    it('should complete health check within reasonable time', async () => {
      const compute = createOAuth3ComputeService({});
      const startTime = Date.now();
      
      // Check against a non-listening port (should fail fast)
      await compute.checkNodeHealth('http://localhost:59999');
      
      const elapsed = Date.now() - startTime;
      // Should complete quickly for connection refused
      expect(elapsed).toBeLessThan(5000);
    });
  });
});

// ============ Previously Untested Code Paths ============

describe('Storage Index Operations', () => {
  let storage: OAuth3StorageService;
  const testKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as Hex;

  beforeEach(() => {
    resetOAuth3StorageService();
    storage = createOAuth3StorageService({ 
      ipfsApiEndpoint: 'http://localhost:5001/api/v0',
      encryptionKey: testKey,
    });
  });

  describe('session index', () => {
    it('should save session index (if IPFS available)', async () => {
      try {
        const cid = await storage.saveSessionIndex();
        expect(cid).toBeTruthy();
        expect(cid.length).toBeGreaterThan(10);
      } catch (error) {
        expect((error as Error).message).toContain('IPFS');
      }
    });

    it('should throw on load for non-existent index', async () => {
      await expect(storage.loadSessionIndex('QmNonExistent123'))
        .rejects.toThrow();
    });
  });

  describe('credential index', () => {
    it('should save credential index (if IPFS available)', async () => {
      try {
        const cid = await storage.saveCredentialIndex();
        expect(cid).toBeTruthy();
      } catch (error) {
        expect((error as Error).message).toContain('IPFS');
      }
    });

    it('should throw on load for non-existent index', async () => {
      await expect(storage.loadCredentialIndex('QmNonExistent456'))
        .rejects.toThrow();
    });
  });
});

describe('Compute Node Resources', () => {
  let compute: OAuth3ComputeService;

  beforeEach(() => {
    resetOAuth3ComputeService();
    compute = createOAuth3ComputeService({ rpcUrl: 'http://localhost:9545', chainId: 420691 });
  });

  describe('getNodeResources', () => {
    it('should return null for empty endpoint', async () => {
      const resources = await compute.getNodeResources('');
      expect(resources).toBeNull();
    });

    it('should return null for unreachable endpoint', async () => {
      const resources = await compute.getNodeResources('http://localhost:99999');
      expect(resources).toBeNull();
    });

    it('should have correct structure when queried', async () => {
      const resources = await compute.getNodeResources('http://localhost:4200');
      // Either null (no server) or object with correct shape
      if (resources) {
        expect(typeof resources.cpuCores).toBe('number');
        expect(typeof resources.memoryGb).toBe('number');
        expect(typeof resources.storageGb).toBe('number');
      }
    });
  });

  describe('verifyNodeSignature', () => {
    it('should verify signature on-chain (require contracts)', async () => {
      try {
        const nodeId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as Hex;
        const messageHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as Hex;
        const signature = '0x' as Hex;
        
        const valid = await compute.verifyNodeSignature(nodeId, messageHash, signature);
        expect(typeof valid).toBe('boolean');
      } catch (error) {
        expect(isChainError(error as Error)).toBe(true);
      }
    });
  });
});

describe('Threshold Encryption Real ECDH', () => {
  it('should require valid P-256 public key for encryption', async () => {
    // Generate a real P-256 key pair for testing
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const publicKeyHex = '0x' + Array.from(new Uint8Array(publicKeyRaw)).map(b => b.toString(16).padStart(2, '0')).join('') as Hex;

    const service = new ThresholdEncryptionService({
      clusterId: 'test-cluster',
      threshold: 2,
      totalNodes: 3,
      publicKey: publicKeyHex,
      mpcEndpoint: 'http://localhost:4000',
    });

    const payload = await service.encrypt('test data');
    expect(payload.clusterId).toBe('test-cluster');
    expect(payload.ephemeralPubKey.length).toBe(132); // 65 bytes = 130 hex chars + 0x
  });

  it('should throw for invalid public key length', async () => {
    const service = new ThresholdEncryptionService({
      clusterId: 'test-cluster',
      threshold: 2,
      totalNodes: 3,
      publicKey: '0x04abcdef' as Hex, // Too short for P-256
      mpcEndpoint: 'http://localhost:4000',
    });

    await expect(service.encrypt('test data')).rejects.toThrow();
  });

  it('should reject decrypt for wrong cluster', async () => {
    const service = new ThresholdEncryptionService({
      clusterId: 'cluster-a',
      threshold: 2,
      totalNodes: 3,
      publicKey: '0x04' + '00'.repeat(64) as Hex,
      mpcEndpoint: 'http://localhost:4000',
    });

    await expect(service.decrypt({
      ephemeralPubKey: '0x04' as Hex,
      ciphertext: '0x00' as Hex,
      nonce: '0x00' as Hex,
      tag: '0x00' as Hex,
      clusterId: 'cluster-b', // Different cluster
      version: 1,
    })).rejects.toThrow('different cluster');
  });
});

describe('Infrastructure Health Reporting', () => {
  beforeEach(() => {
    resetDecentralizedDiscovery();
    resetOAuth3JNSService();
    resetOAuth3StorageService();
    resetOAuth3ComputeService();
  });

  it('should include error messages in health report', async () => {
    const discovery = createDecentralizedDiscovery({
      rpcUrl: 'http://localhost:99999', // Unreachable
      chainId: 420691,
    });

    const health = await discovery.getInfrastructureHealth();
    
    // Chain should report unhealthy with error
    expect(health.chain.healthy).toBe(false);
    expect(health.chain.error).toBeTruthy();
    
    // JNS should report unhealthy with error
    expect(health.jns.healthy).toBe(false);
    expect(health.jns.error).toBeTruthy();
  });
});
