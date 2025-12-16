import { describe, expect, it } from 'bun:test';
import { coordinatorApp } from '../proxy/coordinator';
import { proxyNodeApp } from '../proxy/node';

describe('DWS Proxy', () => {
  describe('Coordinator', () => {
    it('returns health status', async () => {
      const res = await coordinatorApp.fetch(new Request('http://localhost/health'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('dws-proxy-coordinator');
    });

    it('lists nodes (initially empty)', async () => {
      const res = await coordinatorApp.fetch(new Request('http://localhost/nodes'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.nodes).toBeInstanceOf(Array);
    });

    it('registers a node', async () => {
      const res = await coordinatorApp.fetch(
        new Request('http://localhost/nodes/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'test-node-1',
            address: '0x1234567890123456789012345678901234567890',
            region: 'US',
            capacity: 10,
          }),
        })
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.node.id).toBe('test-node-1');
    });

    it('routes to registered node', async () => {
      const res = await coordinatorApp.fetch(
        new Request('http://localhost/route?region=US')
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.node.id).toBe('test-node-1');
    });
  });

  describe('Proxy Node', () => {
    it('returns health status', async () => {
      const res = await proxyNodeApp.fetch(new Request('http://localhost/health'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('dws-proxy-node');
    });

    it('returns stats', async () => {
      const res = await proxyNodeApp.fetch(new Request('http://localhost/stats'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.region).toBe('US');
      expect(typeof data.currentConnections).toBe('number');
    });
  });
});

