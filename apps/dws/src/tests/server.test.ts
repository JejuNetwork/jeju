/**
 * DWS Server Tests
 */

import { describe, expect, it } from 'bun:test';
import { app } from '../server/index';

describe('DWS Server', () => {
  describe('Health & Info', () => {
    it('returns health status', async () => {
      const res = await app.fetch(new Request('http://localhost/health'));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('dws');
    });

    it('returns service info', async () => {
      const res = await app.fetch(new Request('http://localhost/'));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.name).toBe('DWS');
      expect(data.services).toContain('storage');
      expect(data.services).toContain('compute');
      expect(data.services).toContain('cdn');
    });
  });

  describe('Storage Routes', () => {
    it('returns storage health', async () => {
      const res = await app.fetch(new Request('http://localhost/storage/health'));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.service).toBe('dws-storage');
    });

    it('uploads and downloads file', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['test content']), 'test.txt');

      const uploadRes = await app.fetch(new Request('http://localhost/storage/upload', {
        method: 'POST',
        body: formData,
      }));
      expect(uploadRes.status).toBe(200);

      const uploadData = await uploadRes.json();
      expect(uploadData.cid).toBeDefined();

      const downloadRes = await app.fetch(new Request(`http://localhost/storage/download/${uploadData.cid}`));
      expect(downloadRes.status).toBe(200);
    });
  });

  describe('Compute Routes', () => {
    it('returns compute health', async () => {
      const res = await app.fetch(new Request('http://localhost/compute/health'));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.service).toBe('dws-compute');
    });

    it('handles chat completion', async () => {
      const res = await app.fetch(new Request('http://localhost/compute/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }));
      // Returns 200 when provider is configured, 503 otherwise
      expect([200, 503]).toContain(res.status);

      const data = await res.json() as { error?: string; docs?: string; choices?: unknown[] };
      if (res.status === 503) {
        expect(data.error).toBe('No inference provider configured');
        expect(data.docs).toContain('groq.com');
      } else {
        // Provider is configured - expect a valid response
        expect(data.choices).toBeDefined();
      }
    });
  });

  describe('CDN Routes', () => {
    it('returns cdn health', async () => {
      const res = await app.fetch(new Request('http://localhost/cdn/health'));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.service).toBe('dws-cdn');
    });
  });

  describe('A2A Routes', () => {
    it('returns capabilities', async () => {
      const res = await app.fetch(new Request('http://localhost/a2a/capabilities'));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.capabilities.length).toBeGreaterThan(0);
    });
  });

  describe('MCP Routes', () => {
    it('lists tools', async () => {
      const res = await app.fetch(new Request('http://localhost/mcp/tools/list', {
        method: 'POST',
      }));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.tools.length).toBeGreaterThan(0);
    });
  });
});
