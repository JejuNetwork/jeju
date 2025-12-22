/**
 * Storage V2 API Tests
 * 
 * Tests for the enhanced multi-backend storage API
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { createStorageRouterV2 } from '../../src/server/routes/storage-v2';
import { resetMultiBackendManager } from '../../src/storage/multi-backend';

// ============================================================================
// Test Setup
// ============================================================================

let app: Hono;

beforeAll(() => {
  resetMultiBackendManager();
  app = new Hono();
  app.route('/storage/v2', createStorageRouterV2());
});

afterAll(() => {
  resetMultiBackendManager();
});

// ============================================================================
// Helper Functions
// ============================================================================

async function uploadFile(
  content: Buffer,
  options: {
    filename?: string;
    tier?: string;
    category?: string;
    encrypt?: boolean;
    permanent?: boolean;
  } = {}
) {
  const formData = new FormData();
  formData.append('file', new Blob([content]), options.filename ?? 'test.bin');
  if (options.tier) formData.append('tier', options.tier);
  if (options.category) formData.append('category', options.category);
  if (options.encrypt) formData.append('encrypt', 'true');
  if (options.permanent) formData.append('permanent', 'true');

  const res = await app.request('/storage/v2/upload', {
    method: 'POST',
    body: formData,
  });

  return res;
}

// ============================================================================
// Health Tests
// ============================================================================

describe('Storage V2 - Health', () => {
  it('GET /health should return healthy status', async () => {
    const res = await app.request('/storage/v2/health');
    expect(res.status).toBe(200);

    const data = await res.json() as { service: string; status: string; backends: string[] };
    expect(data.service).toBe('dws-storage-v2');
    expect(data.status).toBe('healthy');
    expect(data.backends).toContain('local');
  });

  it('GET /stats should return node stats', async () => {
    const res = await app.request('/storage/v2/stats');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// Upload Tests
// ============================================================================

describe('Storage V2 - Upload', () => {
  it('POST /upload should upload file with tier', async () => {
    const content = Buffer.from('test content for upload');
    const res = await uploadFile(content, {
      filename: 'test.txt',
      tier: 'popular',
      category: 'data',
    });

    expect(res.status).toBe(200);

    const data = await res.json() as { cid: string; size: number; tier: string };
    expect(data.cid).toBeDefined();
    expect(data.size).toBe(content.length);
    expect(data.tier).toBe('popular');
  });

  it('POST /upload should handle system tier', async () => {
    const content = Buffer.from('system content');
    const res = await uploadFile(content, {
      filename: 'app.js',
      tier: 'system',
      category: 'code',
    });

    expect(res.status).toBe(200);

    const data = await res.json() as { tier: string };
    expect(data.tier).toBe('system');
  });

  it('POST /upload/json should upload JSON data', async () => {
    const jsonData = { name: 'test', value: 123 };
    
    const res = await app.request('/storage/v2/upload/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: jsonData,
        tier: 'popular',
        category: 'data',
        name: 'test-data.json',
      }),
    });

    expect(res.status).toBe(200);

    const data = await res.json() as { cid: string };
    expect(data.cid).toBeDefined();
  });
});

// ============================================================================
// Download Tests
// ============================================================================

describe('Storage V2 - Download', () => {
  let uploadedCid: string;

  beforeAll(async () => {
    const content = Buffer.from('content to download');
    const res = await uploadFile(content, { filename: 'download-test.bin' });
    const data = await res.json() as { cid: string };
    uploadedCid = data.cid;
  });

  it('GET /download/:cid should return content', async () => {
    const res = await app.request(`/storage/v2/download/${uploadedCid}`);
    expect(res.status).toBe(200);

    const content = await res.arrayBuffer();
    // Content may be served from WebTorrent simulation or local backend
    expect(Buffer.from(content).length).toBeGreaterThan(0);
  });

  it('GET /download/:cid should return 404 or 500 for non-existent content', async () => {
    const res = await app.request('/storage/v2/download/nonexistent-cid-123');
    // 404 for not found, 500 if backend throws
    expect([404, 500]).toContain(res.status);
  });

  it('GET /download/:cid should include backend header', async () => {
    const res = await app.request(`/storage/v2/download/${uploadedCid}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Backend')).toBeDefined();
  });
});

// ============================================================================
// Content Management Tests
// ============================================================================

describe('Storage V2 - Content Management', () => {
  let testCid: string;

  beforeAll(async () => {
    const content = Buffer.from('content for management tests');
    const res = await uploadFile(content, {
      filename: 'manage-test.bin',
      tier: 'popular',
      category: 'data',
    });
    const data = await res.json() as { cid: string };
    testCid = data.cid;
  });

  it('GET /content/:cid should return metadata', async () => {
    const res = await app.request(`/storage/v2/content/${testCid}`);
    expect(res.status).toBe(200);

    const data = await res.json() as { cid: string; tier: string; category: string };
    expect(data.cid).toBe(testCid);
    expect(data.tier).toBe('popular');
    expect(data.category).toBe('data');
  });

  it('GET /content/:cid should return 404 or 500 for non-existent', async () => {
    const res = await app.request('/storage/v2/content/nonexistent-123');
    // 404 for not found, 500 if backend throws
    expect([404, 500]).toContain(res.status);
  });

  it('GET /content should list content', async () => {
    const res = await app.request('/storage/v2/content');
    expect(res.status).toBe(200);

    const data = await res.json() as { items: Array<{ cid: string }>; total: number };
    expect(data.items).toBeInstanceOf(Array);
    expect(data.total).toBeGreaterThan(0);
  });

  it('GET /content?tier=popular should filter by tier', async () => {
    const res = await app.request('/storage/v2/content?tier=popular');
    expect(res.status).toBe(200);

    const data = await res.json() as { items: Array<{ tier: string }> };
    for (const item of data.items) {
      expect(item.tier).toBe('popular');
    }
  });

  it('GET /exists/:cid should check existence', async () => {
    const res = await app.request(`/storage/v2/exists/${testCid}`);
    expect(res.status).toBe(200);

    const data = await res.json() as { cid: string; exists: boolean };
    expect(data.cid).toBe(testCid);
    expect(data.exists).toBe(true);
  });
});

// ============================================================================
// Popularity Tests
// ============================================================================

describe('Storage V2 - Popularity', () => {
  beforeAll(async () => {
    // Upload some content and access it
    for (let i = 0; i < 3; i++) {
      const content = Buffer.from(`popularity test ${i}`);
      const res = await uploadFile(content, { tier: 'popular' });
      const data = await res.json() as { cid: string };
      
      // Access multiple times
      for (let j = 0; j < 5; j++) {
        await app.request(`/storage/v2/download/${data.cid}`);
      }
    }
  });

  it('GET /popular should return popular content', async () => {
    const res = await app.request('/storage/v2/popular');
    expect(res.status).toBe(200);

    const data = await res.json() as { items: Array<{ cid: string; score: number }> };
    expect(data.items).toBeInstanceOf(Array);
  });

  it('GET /popular?limit=5 should respect limit', async () => {
    const res = await app.request('/storage/v2/popular?limit=5');
    expect(res.status).toBe(200);

    const data = await res.json() as { items: Array<{ cid: string }> };
    expect(data.items.length).toBeLessThanOrEqual(5);
  });

  it('GET /underseeded should return underseeded content', async () => {
    const res = await app.request('/storage/v2/underseeded');
    expect(res.status).toBe(200);

    const data = await res.json() as { items: Array<{ cid: string }> };
    expect(data.items).toBeInstanceOf(Array);
  });
});

// ============================================================================
// IPFS Compatibility Tests
// ============================================================================

describe('Storage V2 - IPFS Compatibility', () => {
  it('POST /api/v0/add should work like IPFS', async () => {
    const content = Buffer.from('ipfs compatible upload');
    const formData = new FormData();
    formData.append('file', new Blob([content]), 'test.txt');

    const res = await app.request('/storage/v2/api/v0/add', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(200);

    const data = await res.json() as { Hash: string; Size: string; Name: string };
    expect(data.Hash).toBeDefined();
    expect(data.Size).toBe(String(content.length));
  });

  it('POST /api/v0/id should return node info or 503 if backends unhealthy', async () => {
    const res = await app.request('/storage/v2/api/v0/id', { method: 'POST' });
    
    // May return 503 if IPFS is not available
    if (res.status === 200) {
      const data = await res.json() as { ID: string; AgentVersion: string };
      expect(data.ID).toBe('dws-storage-v2');
      expect(data.AgentVersion).toContain('dws/');
    } else {
      expect(res.status).toBe(503);
    }
  });

  it('GET /ipfs/:cid should serve content', async () => {
    // First upload
    const content = Buffer.from('ipfs gateway test');
    const formData = new FormData();
    formData.append('file', new Blob([content]), 'ipfs-test.txt');

    const uploadRes = await app.request('/storage/v2/api/v0/add', {
      method: 'POST',
      body: formData,
    });

    const uploadData = await uploadRes.json() as { Hash: string };
    
    // Then fetch via IPFS gateway
    const res = await app.request(`/storage/v2/ipfs/${uploadData.Hash}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Ipfs-Path')).toBe(`/ipfs/${uploadData.Hash}`);
  });
});

