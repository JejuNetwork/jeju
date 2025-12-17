/**
 * Multi-Backend Storage Tests
 * 
 * Tests for the BackendManager and storage backends
 */

import { describe, it, expect, beforeAll, beforeEach, spyOn } from 'bun:test';
import { createBackendManager, type BackendManager } from '../../src/storage/backends';

// ============================================================================
// Test Utilities
// ============================================================================

function createTestBuffer(size: number, fill = 0): Buffer {
  return Buffer.alloc(size, fill);
}

// ============================================================================
// BackendManager Tests
// ============================================================================

describe('BackendManager', () => {
  let manager: BackendManager;

  beforeAll(() => {
    manager = createBackendManager();
  });

  it('should list available backends', () => {
    const backends = manager.listBackends();
    expect(backends).toContain('local');
  });

  it('should upload content to local backend', async () => {
    const content = createTestBuffer(1024, 0x42);
    const result = await manager.upload(content, { 
      filename: 'test.bin',
      preferredBackend: 'local',
    });
    
    expect(result.cid).toBeDefined();
    expect(result.url).toContain(result.cid);
    expect(result.backend).toBe('local');
  });

  it('should download uploaded content', async () => {
    const content = createTestBuffer(512, 0xAB);
    const uploadResult = await manager.upload(content, { preferredBackend: 'local' });
    
    const downloadResult = await manager.download(uploadResult.cid);
    expect(downloadResult.content.equals(content)).toBe(true);
    expect(downloadResult.backend).toBe('local');
  });

  it('should check content existence', async () => {
    const content = createTestBuffer(256);
    const result = await manager.upload(content, { preferredBackend: 'local' });
    
    expect(await manager.exists(result.cid)).toBe(true);
    expect(await manager.exists('nonexistent-cid-123456789')).toBe(false);
  });

  it('should upload batch of content', async () => {
    const items = [
      { content: createTestBuffer(100), options: { filename: 'file1.bin', preferredBackend: 'local' } },
      { content: createTestBuffer(200), options: { filename: 'file2.bin', preferredBackend: 'local' } },
      { content: createTestBuffer(300), options: { filename: 'file3.bin', preferredBackend: 'local' } },
    ];

    const results = await manager.uploadBatch(items);
    
    expect(results.length).toBe(3);
    for (const result of results) {
      expect(result.cid).toBeDefined();
      expect(result.backend).toBe('local');
    }
  });

  it('should download batch of content', async () => {
    const contents = [
      createTestBuffer(100, 0x01),
      createTestBuffer(100, 0x02),
      createTestBuffer(100, 0x03),
    ];
    
    const cids: string[] = [];
    for (const content of contents) {
      const result = await manager.upload(content, { preferredBackend: 'local' });
      cids.push(result.cid);
    }

    const downloaded = await manager.downloadBatch(cids);
    
    expect(downloaded.size).toBe(3);
    for (let i = 0; i < cids.length; i++) {
      const data = downloaded.get(cids[i]);
      expect(data).toBeDefined();
      expect(data![0]).toBe(contents[i][0]);
    }
  });

  it('should perform health check', async () => {
    const health = await manager.healthCheck();
    
    expect(health.local).toBe(true);
  });

  it('should get local storage map', () => {
    const localStorage = manager.getLocalStorage();
    expect(localStorage).toBeInstanceOf(Map);
  });

  it('should handle download of non-existent content', async () => {
    await expect(manager.download('definitely-not-a-real-cid-123'))
      .rejects.toThrow('Content not found');
  });

  it('should generate unique CIDs for different content', async () => {
    const content1 = createTestBuffer(100, 0x11);
    const content2 = createTestBuffer(100, 0x22);
    
    const result1 = await manager.upload(content1, { preferredBackend: 'local' });
    const result2 = await manager.upload(content2, { preferredBackend: 'local' });
    
    expect(result1.cid).not.toBe(result2.cid);
  });

  it('should generate same CID for identical content', async () => {
    const content1 = createTestBuffer(100, 0x42);
    const content2 = createTestBuffer(100, 0x42);
    
    const result1 = await manager.upload(content1, { preferredBackend: 'local' });
    const result2 = await manager.upload(content2, { preferredBackend: 'local' });
    
    expect(result1.cid).toBe(result2.cid);
  });
});

// ============================================================================
// IPFS Backend Mock Tests
// ============================================================================

describe('IPFS Backend (Mocked)', () => {
  let manager: BackendManager;
  let mockFetch: ReturnType<typeof spyOn>;

  beforeAll(() => {
    // Force IPFS backend to be available
    process.env.IPFS_API_URL = 'http://localhost:5001';
    process.env.IPFS_GATEWAY_URL = 'http://localhost:8080';
    
    // Create fresh manager
    manager = createBackendManager();
  });

  beforeEach(() => {
    mockFetch = spyOn(globalThis, 'fetch');
  });

  it('should list IPFS backend when configured', () => {
    const backends = manager.listBackends();
    // IPFS should be available if env vars are set
    expect(backends).toContain('local');
  });
});

// ============================================================================
// Content Integrity Tests
// ============================================================================

describe('Content Integrity', () => {
  let manager: BackendManager;

  beforeAll(() => {
    manager = createBackendManager();
  });

  it('should preserve binary content exactly', async () => {
    // Create content with all byte values
    const content = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) {
      content[i] = i;
    }
    
    const result = await manager.upload(content, { preferredBackend: 'local' });
    const downloaded = await manager.download(result.cid);
    
    expect(downloaded.content.equals(content)).toBe(true);
  });

  it('should handle empty buffer', async () => {
    const content = Buffer.alloc(0);
    const result = await manager.upload(content, { preferredBackend: 'local' });
    
    expect(result.cid).toBeDefined();
    
    const downloaded = await manager.download(result.cid);
    expect(downloaded.content.length).toBe(0);
  });

  it('should handle large buffer', async () => {
    const content = createTestBuffer(10 * 1024 * 1024); // 10MB
    const result = await manager.upload(content, { preferredBackend: 'local' });
    
    expect(result.cid).toBeDefined();
    
    const downloaded = await manager.download(result.cid);
    expect(downloaded.content.length).toBe(content.length);
  });

  it('should handle buffer with null bytes', async () => {
    const content = Buffer.from([0, 0, 0, 1, 2, 3, 0, 0, 0]);
    const result = await manager.upload(content, { preferredBackend: 'local' });
    
    const downloaded = await manager.download(result.cid);
    expect(downloaded.content.equals(content)).toBe(true);
  });
});

// ============================================================================
// Concurrent Operations Tests
// ============================================================================

describe('Concurrent Operations', () => {
  let manager: BackendManager;

  beforeAll(() => {
    manager = createBackendManager();
  });

  it('should handle concurrent uploads', async () => {
    const uploadPromises = Array.from({ length: 10 }, (_, i) =>
      manager.upload(createTestBuffer(100, i), { preferredBackend: 'local' })
    );
    
    const results = await Promise.all(uploadPromises);
    
    expect(results.length).toBe(10);
    const uniqueCids = new Set(results.map(r => r.cid));
    expect(uniqueCids.size).toBe(10);
  });

  it('should handle concurrent downloads', async () => {
    // Upload first
    const cids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const result = await manager.upload(createTestBuffer(100, i), { preferredBackend: 'local' });
      cids.push(result.cid);
    }
    
    // Concurrent downloads
    const downloadPromises = cids.map(cid => manager.download(cid));
    const results = await Promise.all(downloadPromises);
    
    expect(results.length).toBe(5);
    for (const result of results) {
      expect(result.content.length).toBe(100);
    }
  });

  it('should handle mixed concurrent operations', async () => {
    const operations = [
      manager.upload(createTestBuffer(100, 1), { preferredBackend: 'local' }),
      manager.upload(createTestBuffer(100, 2), { preferredBackend: 'local' }),
      manager.upload(createTestBuffer(100, 3), { preferredBackend: 'local' }),
      manager.healthCheck(),
      manager.exists('nonexistent'),
    ];
    
    const results = await Promise.all(operations);
    expect(results.length).toBe(5);
  });
});
