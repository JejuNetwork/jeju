/**
 * Storage Backend Integration Tests
 * 
 * Run with: bun test tests/storage.test.ts
 * Or via: bun run test:integration
 */

import { describe, test, expect, beforeEach, setDefaultTimeout } from 'bun:test';
import { createBackendManager, type BackendManager } from '../src/storage/backends';
import { app } from '../src/server';

setDefaultTimeout(10000);

// Only skip if explicitly requested, not by default in CI
const SKIP = process.env.SKIP_INTEGRATION === 'true';

describe.skipIf(SKIP)('Storage Backends', () => {
  let backend: BackendManager;

  beforeEach(() => {
    backend = createBackendManager();
  });

  describe('Local Backend', () => {
    test('should upload and download content', async () => {
      const content = Buffer.from('test content');
      const result = await backend.upload(content, { preferredBackend: 'local' });

      expect(result.cid).toBeDefined();
      expect(result.backend).toBe('local');
      expect(result.url).toContain(result.cid);

      const downloaded = await backend.download(result.cid);
      expect(downloaded.content.toString()).toBe('test content');
      expect(downloaded.backend).toBe('local');
    });

    test('should generate deterministic CIDs for same content', async () => {
      const content = Buffer.from('deterministic test');
      const result1 = await backend.upload(content, { preferredBackend: 'local' });
      const result2 = await backend.upload(content, { preferredBackend: 'local' });

      expect(result1.cid).toBe(result2.cid);
    });

    test('should generate different CIDs for different content', async () => {
      const result1 = await backend.upload(Buffer.from('content A'), { preferredBackend: 'local' });
      const result2 = await backend.upload(Buffer.from('content B'), { preferredBackend: 'local' });

      expect(result1.cid).not.toBe(result2.cid);
    });

    test('should handle empty content', async () => {
      const result = await backend.upload(Buffer.alloc(0), { preferredBackend: 'local' });

      expect(result.cid).toBeDefined();

      const downloaded = await backend.download(result.cid);
      expect(downloaded.content.length).toBe(0);
    });

    test('should handle large content', async () => {
      const largeContent = Buffer.alloc(10 * 1024 * 1024, 'x'); // 10MB
      const result = await backend.upload(largeContent, { preferredBackend: 'local' });

      expect(result.cid).toBeDefined();

      const downloaded = await backend.download(result.cid);
      expect(downloaded.content.length).toBe(largeContent.length);
      expect(downloaded.content.equals(largeContent)).toBe(true);
    });

    test('should handle binary content with null bytes', async () => {
      const binaryContent = Buffer.from([0x00, 0xff, 0x00, 0xfe, 0x01, 0x02]);
      const result = await backend.upload(binaryContent, { preferredBackend: 'local' });

      const downloaded = await backend.download(result.cid);
      expect(downloaded.content.equals(binaryContent)).toBe(true);
    });

    test('should throw for non-existent CID', async () => {
      await expect(backend.download('nonexistent-cid-12345')).rejects.toThrow();
    });

    test('exists() should return true for uploaded content', async () => {
      const result = await backend.upload(Buffer.from('exists test'), { preferredBackend: 'local' });

      expect(await backend.exists(result.cid)).toBe(true);
    });

    test('exists() should return false for non-existent content', async () => {
      expect(await backend.exists('nonexistent-cid-67890')).toBe(false);
    });
  });

  describe('Batch Operations', () => {
    test('uploadBatch should upload multiple files', async () => {
      const items = [
        { content: Buffer.from('file 1'), options: { preferredBackend: 'local' } },
        { content: Buffer.from('file 2'), options: { preferredBackend: 'local' } },
        { content: Buffer.from('file 3'), options: { preferredBackend: 'local' } },
      ];

      const results = await backend.uploadBatch(items);

      expect(results).toHaveLength(3);
      expect(new Set(results.map((r) => r.cid)).size).toBe(3); // All unique CIDs
    });

    test('downloadBatch should download multiple files', async () => {
      const item1 = await backend.upload(Buffer.from('batch item 1'), { preferredBackend: 'local' });
      const item2 = await backend.upload(Buffer.from('batch item 2'), { preferredBackend: 'local' });

      const results = await backend.downloadBatch([item1.cid, item2.cid]);

      expect(results.size).toBe(2);
      expect(results.get(item1.cid)?.toString()).toBe('batch item 1');
      expect(results.get(item2.cid)?.toString()).toBe('batch item 2');
    });

    test('downloadBatch should skip non-existent CIDs gracefully', async () => {
      const item1 = await backend.upload(Buffer.from('exists'), { preferredBackend: 'local' });

      const results = await backend.downloadBatch([item1.cid, 'nonexistent-cid']);

      expect(results.size).toBe(1);
      expect(results.has(item1.cid)).toBe(true);
      expect(results.has('nonexistent-cid')).toBe(false);
    });
  });

  describe('Concurrent Operations', () => {
    test('should handle concurrent uploads', async () => {
      const uploads = Array.from({ length: 50 }, (_, i) =>
        backend.upload(Buffer.from(`concurrent content ${i}`), { preferredBackend: 'local' })
      );

      const results = await Promise.all(uploads);

      expect(results).toHaveLength(50);
      const uniqueCids = new Set(results.map((r) => r.cid));
      expect(uniqueCids.size).toBe(50);
    });

    test('should handle concurrent downloads of same CID', async () => {
      const content = Buffer.from('shared content for concurrent download');
      const result = await backend.upload(content, { preferredBackend: 'local' });

      const downloads = Array.from({ length: 20 }, () => backend.download(result.cid));

      const results = await Promise.all(downloads);

      results.forEach((r) => {
        expect(r.content.toString()).toBe('shared content for concurrent download');
      });
    });

    test('should handle mixed concurrent operations', async () => {
      const operations: Promise<unknown>[] = [];

      // Mix uploads and downloads
      for (let i = 0; i < 30; i++) {
        if (i % 3 === 0) {
          operations.push(backend.upload(Buffer.from(`mixed op ${i}`), { preferredBackend: 'local' }));
        } else {
          // Upload then immediately download
          operations.push(
            backend.upload(Buffer.from(`mixed download ${i}`), { preferredBackend: 'local' }).then((r) => backend.download(r.cid))
          );
        }
      }

      const results = await Promise.all(operations);
      expect(results).toHaveLength(30);
    });
  });

  describe('Health Check', () => {
    test('healthCheck should return status for all backends', async () => {
      const health = await backend.healthCheck();

      expect(health).toHaveProperty('local');
      expect(health.local).toBe(true);
    });

    test('listBackends should return available backends', () => {
      const backends = backend.listBackends();

      expect(backends).toContain('local');
      expect(backends.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe.skipIf(SKIP)('Storage HTTP API', () => {
  describe('Health Endpoint', () => {
    test('GET /storage/health should return healthy', async () => {
      const res = await app.request('/storage/health');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('healthy');
      expect(body.backends).toContain('local');
    });
  });

  describe('Upload Endpoint', () => {
    test('POST /storage/upload should accept file and return CID', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['test file content']), 'test.txt');

      const res = await app.request('/storage/upload', {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.cid).toBeDefined();
      expect(body.size).toBe(17); // 'test file content'.length
    });

    test('POST /storage/upload without file should return 400', async () => {
      const formData = new FormData();

      const res = await app.request('/storage/upload', {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(400);
    });

    test('POST /storage/upload should handle binary files', async () => {
      const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
      const formData = new FormData();
      formData.append('file', new Blob([binaryData]), 'test.png');

      const res = await app.request('/storage/upload', {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.cid).toBeDefined();
      expect(body.size).toBe(8);
    });
  });

  describe('Download Endpoint', () => {
    test('GET /storage/download/:cid should return uploaded content', async () => {
      // First upload
      const formData = new FormData();
      formData.append('file', new Blob(['download test content']), 'test.txt');

      const uploadRes = await app.request('/storage/upload', {
        method: 'POST',
        body: formData,
      });

      const { cid } = await uploadRes.json();

      // Then download
      const downloadRes = await app.request(`/storage/download/${cid}`);

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get('Content-Type')).toBe('application/octet-stream');

      const content = await downloadRes.text();
      expect(content).toBe('download test content');
    });

    test('GET /storage/download/:cid for non-existent CID should return 404', async () => {
      const res = await app.request('/storage/download/nonexistent-cid-xyz');

      expect(res.status).toBe(404);
    });
  });

  describe('Exists Endpoint', () => {
    test('GET /storage/exists/:cid should return exists=true for existing content', async () => {
      // Upload first
      const formData = new FormData();
      formData.append('file', new Blob(['exists check']), 'test.txt');

      const uploadRes = await app.request('/storage/upload', {
        method: 'POST',
        body: formData,
      });

      const { cid } = await uploadRes.json();

      // Check exists
      const existsRes = await app.request(`/storage/exists/${cid}`);

      expect(existsRes.status).toBe(200);
      const body = await existsRes.json();
      expect(body.exists).toBe(true);
      expect(body.cid).toBe(cid);
    });

    test('GET /storage/exists/:cid should return exists=false for non-existent content', async () => {
      const res = await app.request('/storage/exists/nonexistent-cid-abc');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.exists).toBe(false);
    });
  });
});

describe.skipIf(SKIP)('Storage Edge Cases', () => {
  let backend: BackendManager;

  beforeEach(() => {
    backend = createBackendManager();
  });

  test('should handle content with special characters', async () => {
    const content = Buffer.from('Special chars: 日本語 🎉 émojis\n\t\r');
    const result = await backend.upload(content, { preferredBackend: 'local' });

    const downloaded = await backend.download(result.cid);
    expect(downloaded.content.equals(content)).toBe(true);
  });

  test('should handle content that looks like a CID', async () => {
    const content = Buffer.from('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
    const result = await backend.upload(content, { preferredBackend: 'local' });

    const downloaded = await backend.download(result.cid);
    expect(downloaded.content.toString()).toBe('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
  });

  test('should handle exactly 1 byte content', async () => {
    const result = await backend.upload(Buffer.from([0x42]), { preferredBackend: 'local' });

    const downloaded = await backend.download(result.cid);
    expect(downloaded.content.length).toBe(1);
    expect(downloaded.content[0]).toBe(0x42);
  });

  test('should handle filename with special characters in options', async () => {
    const result = await backend.upload(Buffer.from('test'), {
      preferredBackend: 'local',
      filename: 'file with spaces & special (chars).txt',
    });

    expect(result.cid).toBeDefined();
  });
});

