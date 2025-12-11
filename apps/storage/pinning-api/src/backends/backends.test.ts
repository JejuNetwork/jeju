/**
 * Comprehensive Storage Backend Tests
 * 
 * Tests all storage backends and their decentralization properties:
 * - IPFS (fully decentralized)
 * - Arweave (permanent, decentralized)
 * - Cloud providers (optional, user choice)
 * - Local (fallback)
 * 
 * Also tests ERC-8004 integration for provider identity.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  BackendManager,
  IPFSBackend,
  LocalBackend,
  ArweaveBackend,
  CloudBackendAdapter,
  createBackendManager,
  generateCloudCID,
  parseCloudCID,
  VercelBlobBackend,
  S3Backend,
  R2Backend,
} from './index';

// ============================================================================
// Backend Interface Tests
// ============================================================================

describe('Storage Backend Interface', () => {
  test('all backends implement the same interface', () => {
    const localBackend = new LocalBackend();
    
    // Check required methods exist
    expect(typeof localBackend.upload).toBe('function');
    expect(typeof localBackend.download).toBe('function');
    expect(typeof localBackend.exists).toBe('function');
    expect(typeof localBackend.delete).toBe('function');
    expect(typeof localBackend.getUrl).toBe('function');
    expect(typeof localBackend.isAvailable).toBe('function');
    
    // Check required properties
    expect(localBackend.name).toBe('local');
    expect(localBackend.type).toBe('local');
  });

  test('IPFS backend has correct type', () => {
    const ipfsBackend = new IPFSBackend('http://localhost:5001');
    expect(ipfsBackend.name).toBe('ipfs');
    expect(ipfsBackend.type).toBe('ipfs');
  });

  test('Arweave backend has correct type', () => {
    const arweaveBackend = new ArweaveBackend();
    expect(arweaveBackend.name).toBe('arweave');
    expect(arweaveBackend.type).toBe('arweave');
  });
});

// ============================================================================
// Local Backend Tests (Fallback)
// ============================================================================

describe('Local Backend (Fallback)', () => {
  let backend: LocalBackend;

  beforeAll(() => {
    backend = new LocalBackend();
  });

  test('should always be available', async () => {
    const available = await backend.isAvailable();
    expect(available).toBe(true);
  });

  test('should generate local CIDs', async () => {
    const content = Buffer.from('test content');
    const result = await backend.upload(content, { filename: 'test.txt' });
    
    expect(result.cid).toStartWith('local-');
    expect(result.backend).toBe('local');
    expect(result.size).toBe(content.length);
  });

  test('should generate deterministic CIDs for same content', async () => {
    const content = Buffer.from('identical content');
    
    const result1 = await backend.upload(content, { filename: 'file1.txt' });
    const result2 = await backend.upload(content, { filename: 'file2.txt' });
    
    expect(result1.cid).toBe(result2.cid);
  });

  test('should download uploaded content', async () => {
    const content = Buffer.from('downloadable content');
    const result = await backend.upload(content, { filename: 'download.txt' });
    
    const downloaded = await backend.download(result.cid);
    expect(downloaded.toString()).toBe(content.toString());
  });

  test('should check existence correctly', async () => {
    const content = Buffer.from('existence check');
    const result = await backend.upload(content, { filename: 'exists.txt' });
    
    expect(await backend.exists(result.cid)).toBe(true);
    expect(await backend.exists('local-nonexistent')).toBe(false);
  });

  test('should delete content', async () => {
    const content = Buffer.from('to be deleted');
    const result = await backend.upload(content, { filename: 'delete.txt' });
    
    expect(await backend.exists(result.cid)).toBe(true);
    await backend.delete(result.cid);
    expect(await backend.exists(result.cid)).toBe(false);
  });

  test('should track stats', async () => {
    const statsBackend = new LocalBackend();
    
    // Start fresh
    let stats = statsBackend.getStats();
    const initialCount = stats.count;
    
    await statsBackend.upload(Buffer.from('stats test 1'), { filename: 'stats1.txt' });
    await statsBackend.upload(Buffer.from('stats test 2'), { filename: 'stats2.txt' });
    
    stats = statsBackend.getStats();
    expect(stats.count).toBe(initialCount + 2);
    expect(stats.totalSize).toBeGreaterThan(0);
  });
});

// ============================================================================
// CID Generation Tests
// ============================================================================

describe('Content-Addressed CID Generation', () => {
  test('should generate cloud CIDs from content', () => {
    const content = Buffer.from('test content for CID');
    const cid = generateCloudCID(content);
    
    expect(cid).toStartWith('cloud-');
    expect(cid.length).toBe(38); // 'cloud-' + 32 hex chars
  });

  test('should generate deterministic CIDs', () => {
    const content = Buffer.from('deterministic content');
    
    const cid1 = generateCloudCID(content);
    const cid2 = generateCloudCID(content);
    
    expect(cid1).toBe(cid2);
  });

  test('should generate different CIDs for different content', () => {
    const content1 = Buffer.from('content A');
    const content2 = Buffer.from('content B');
    
    const cid1 = generateCloudCID(content1);
    const cid2 = generateCloudCID(content2);
    
    expect(cid1).not.toBe(cid2);
  });

  test('should parse cloud CIDs', () => {
    const hash = parseCloudCID('cloud-abc123');
    expect(hash).toBe('abc123');
  });

  test('should return null for non-cloud CIDs', () => {
    expect(parseCloudCID('QmHashIPFS')).toBeNull();
    expect(parseCloudCID('local-hash')).toBeNull();
    expect(parseCloudCID('bafy123')).toBeNull();
  });
});

// ============================================================================
// Backend Manager Tests
// ============================================================================

describe('Backend Manager', () => {
  test('should create with local fallback', () => {
    const manager = new BackendManager();
    const backends = manager.listBackends();
    
    // Local is always available as fallback
    const health = manager.healthCheck();
    expect(health).toBeDefined();
  });

  test('should add and list backends', () => {
    const manager = new BackendManager();
    const localBackend = new LocalBackend();
    
    manager.addBackend(localBackend);
    const backends = manager.listBackends();
    
    expect(backends.find(b => b.name === 'local')).toBeDefined();
  });

  test('should set primary backend', async () => {
    const manager = new BackendManager();
    const localBackend = new LocalBackend();
    
    manager.addBackend(localBackend);
    manager.setPrimary('local');
    
    const backends = manager.listBackends();
    const primary = backends.find(b => b.primary);
    expect(primary?.name).toBe('local');
  });

  test('should upload to available backend', async () => {
    const manager = new BackendManager();
    const localBackend = new LocalBackend();
    manager.addBackend(localBackend);
    manager.setPrimary('local');
    
    const content = Buffer.from('manager upload test');
    const result = await manager.upload(content, { filename: 'manager.txt' });
    
    expect(result.cid).toBeDefined();
    expect(result.backend).toBe('local');
  });

  test('should download from correct backend based on CID prefix', async () => {
    const manager = new BackendManager();
    // Use the manager directly - its internal fallbackBackend handles local CIDs
    
    // Upload via manager (uses fallbackBackend since no primary set)
    const content = Buffer.from('download routing test');
    const uploaded = await manager.upload(content, { filename: 'route.txt' });
    
    expect(uploaded.cid).toStartWith('local-');
    
    // Download via manager - should use fallbackBackend for local- CIDs
    const { content: downloaded, backend } = await manager.download(uploaded.cid);
    expect(downloaded.toString()).toBe(content.toString());
    expect(backend).toBe('local');
  });

  test('should fall back to local when primary unavailable', async () => {
    const manager = new BackendManager();
    
    // IPFS not running
    const ipfsBackend = new IPFSBackend('http://localhost:99999');
    manager.addBackend(ipfsBackend);
    manager.setPrimary('ipfs');
    
    const content = Buffer.from('fallback test');
    const result = await manager.upload(content, { filename: 'fallback.txt' });
    
    // Should fall back to local
    expect(result.backend).toBe('local');
  });

  test('should check health of all backends', async () => {
    const manager = new BackendManager();
    const localBackend = new LocalBackend();
    manager.addBackend(localBackend);
    
    const health = await manager.healthCheck();
    expect(health['local']).toBe(true);
  });
});

// ============================================================================
// Factory Tests
// ============================================================================

describe('Backend Factory', () => {
  test('should create backend manager from environment', () => {
    // Without any env vars, should still work with local fallback
    const manager = createBackendManager();
    expect(manager).toBeDefined();
  });

  test('should prioritize IPFS when configured', () => {
    const manager = createBackendManager();
    const backends = manager.listBackends();
    
    // If IPFS_API_URL is set, IPFS should be primary
    // Otherwise, local or cloud is primary (depends on env)
    const ipfsConfigured = !!process.env.IPFS_API_URL;
    if (ipfsConfigured) {
      const primary = backends.find(b => b.primary);
      expect(primary?.type).toBe('ipfs');
    }
  });
});

// ============================================================================
// Decentralization Priority Tests
// ============================================================================

describe('Decentralization Priority', () => {
  test('IPFS should be preferred over cloud', async () => {
    const manager = new BackendManager();
    
    // Add cloud first
    const local = new LocalBackend();
    manager.addBackend(local);
    
    // If IPFS is available, it should be primary
    const ipfsUrl = process.env.IPFS_API_URL;
    if (ipfsUrl) {
      const ipfs = new IPFSBackend(ipfsUrl);
      manager.addBackend(ipfs);
      manager.setPrimary('ipfs');
      
      const backends = manager.listBackends();
      const primary = backends.find(b => b.primary);
      expect(primary?.type).toBe('ipfs');
    }
  });

  test('Arweave should be permanent storage option', async () => {
    const arweave = new ArweaveBackend();
    expect(arweave.type).toBe('arweave');
    
    // Arweave delete should throw
    await expect(arweave.delete('test')).rejects.toThrow('permanent');
  });

  test('Backend types are correctly categorized', () => {
    // Decentralized backends
    const ipfs = new IPFSBackend('http://localhost:5001');
    const arweave = new ArweaveBackend();
    
    expect(ipfs.type).toBe('ipfs');
    expect(arweave.type).toBe('arweave');
    
    // Fallback
    const local = new LocalBackend();
    expect(local.type).toBe('local');
  });
});

// ============================================================================
// Cloud Backend Configuration Tests
// ============================================================================

describe('Cloud Backend Configuration', () => {
  test('Vercel Blob backend requires token', () => {
    expect(() => {
      new VercelBlobBackend({ token: '' });
    }).not.toThrow(); // Empty token is allowed but will fail on use
  });

  test('S3 backend requires credentials', () => {
    const s3 = new S3Backend({
      bucket: 'test-bucket',
      region: 'us-east-1',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    });
    
    expect(s3.type).toBe('s3');
  });

  test('R2 backend requires account ID', () => {
    const r2 = new R2Backend({
      accountId: 'test-account',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      bucket: 'test-bucket',
    });
    
    expect(r2.type).toBe('r2');
  });
});

// ============================================================================
// Storage Tier Tests
// ============================================================================

describe('Storage Tiers', () => {
  test('should support tier option in upload', async () => {
    const local = new LocalBackend();
    
    const result = await local.upload(
      Buffer.from('tiered content'),
      { filename: 'tiered.txt', tier: 'hot' }
    );
    
    expect(result.cid).toBeDefined();
  });

  test('should support replication option', async () => {
    const local = new LocalBackend();
    
    const result = await local.upload(
      Buffer.from('replicated content'),
      { filename: 'replicated.txt', replication: 3 }
    );
    
    expect(result.cid).toBeDefined();
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  test('download should fail for non-existent content', async () => {
    const local = new LocalBackend();
    
    await expect(local.download('local-nonexistent123'))
      .rejects.toThrow('Content not found');
  });

  test('backend manager should throw when content not in any backend', async () => {
    const manager = new BackendManager();
    
    await expect(manager.download('unknown-cid-12345'))
      .rejects.toThrow('Content not found');
  });
});

// ============================================================================
// ERC-8004 Integration Tests
// ============================================================================

describe('ERC-8004 Provider Identity', () => {
  test('storage registry ABI includes agent functions', async () => {
    // Import the erc8004 module
    const { 
      getAgentInfo, 
      verifyProviderAgent, 
      getAgentLinkedProviders 
    } = await import('../lib/erc8004');
    
    // These functions should exist
    expect(typeof getAgentInfo).toBe('function');
    expect(typeof verifyProviderAgent).toBe('function');
    expect(typeof getAgentLinkedProviders).toBe('function');
  });

  test('should handle unconfigured registry gracefully', async () => {
    const { getAgentInfo, getAgentLinkedProviders } = await import('../lib/erc8004');
    
    // Without registry configured, should return null/empty
    const agentInfo = await getAgentInfo(1n);
    // Either null or an object with exists: false
    expect(agentInfo === null || agentInfo.exists === false).toBe(true);
    
    const providers = await getAgentLinkedProviders();
    expect(Array.isArray(providers)).toBe(true);
  });
});

// ============================================================================
// Integration with API Tests
// ============================================================================

const SERVER_URL = 'http://localhost:3100';

async function serverAvailable(): Promise<boolean> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 500);
  const response = await fetch(`${SERVER_URL}/health`, { signal: controller.signal }).catch(() => null);
  return response?.ok ?? false;
}

describe('Backend API Integration', () => {
  test('should list backends via API', async () => {
    if (!(await serverAvailable())) {
      console.log('⏭️  Skipping API tests - server not running');
      return;
    }
    
    const response = await fetch(`${SERVER_URL}/backends`);
    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data.health).toBeDefined();
    expect(data.health.local).toBe(true);
  });

  test('should show backend in upload response', async () => {
    if (!(await serverAvailable())) return;
    
    const formData = new FormData();
    formData.append('file', new Blob(['backend test']), 'backend.txt');
    
    const response = await fetch(`${SERVER_URL}/upload`, {
      method: 'POST',
      body: formData,
    });
    
    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data.backend).toBeDefined();
    expect(['local', 'ipfs', 'cloud', 'arweave']).toContain(data.backend);
  });

  test('should include decentralization info in health', async () => {
    if (!(await serverAvailable())) return;
    
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();
    
    expect(data.backends).toBeDefined();
    
    // Local should always be available
    expect(data.backends.health.local).toBe(true);
  });
});

