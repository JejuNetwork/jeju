/**
 * Storage Backends Tests
 */

import { describe, expect, it } from 'bun:test';
import { createBackendManager } from '../storage/backends';

describe('Storage Backends', () => {
  const manager = createBackendManager();

  it('lists available backends', () => {
    const backends = manager.listBackends();
    expect(backends).toContain('local');
  });

  it('health checks backends', async () => {
    const health = await manager.healthCheck();
    expect(health.local).toBe(true);
  });

  it('uploads to local backend', async () => {
    const content = Buffer.from('test content');
    const result = await manager.upload(content, { filename: 'test.txt' });

    expect(result.cid).toBeDefined();
    expect(result.backend).toBe('local');
  });

  it('downloads from local backend', async () => {
    const content = Buffer.from('download test');
    const uploaded = await manager.upload(content);

    const downloaded = await manager.download(uploaded.cid);
    expect(downloaded.content.toString()).toBe('download test');
  });
});
