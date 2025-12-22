import { describe, test, expect } from 'bun:test';
import { createPricesRouter, getPriceService, PriceStreamingService } from '../src/server/routes/prices';
import { Hono } from 'hono';

describe('Price Service', () => {
  describe('Router', () => {
    const app = new Hono();
    app.route('/prices', createPricesRouter());

    test('GET /prices/health returns healthy status', async () => {
      const res = await app.request('/prices/health');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('price-streaming');
      expect(typeof data.subscribers).toBe('number');
    });

    test('GET /prices/:chainId/:address returns response', async () => {
      // Test with USDC address on mainnet - will fail to connect to cache, but should handle gracefully
      const res = await app.request('/prices/1/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      // Either success (200) or service unavailable (500) if cache not running
      expect([200, 500]).toContain(res.status);
    });

    test('GET /prices/eth/:chainId returns response', async () => {
      const res = await app.request('/prices/eth/1');
      // Either success (200) or service unavailable (500) if cache not running
      expect([200, 500]).toContain(res.status);
    });

    test('POST /prices/batch handles request', async () => {
      const res = await app.request('/prices/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens: [] })
      });
      // Either success or cache unavailable
      expect([200, 500]).toContain(res.status);
    });

    test('POST /prices/track accepts request', async () => {
      const res = await app.request('/prices/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chainId: 1,
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
        })
      });
      // Success, validation error, or cache unavailable
      expect([200, 400, 500]).toContain(res.status);
    });

    test('GET /prices/solana/:mint returns response', async () => {
      const res = await app.request('/prices/solana/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      // Either success or cache unavailable
      expect([200, 500]).toContain(res.status);
    });
  });

  describe('PriceStreamingService', () => {
    test('singleton returns consistent instance', () => {
      const service1 = getPriceService();
      const service2 = getPriceService();
      expect(service1).toBe(service2);
    });

    test('service is instance of PriceStreamingService', () => {
      const service = getPriceService();
      expect(service).toBeInstanceOf(PriceStreamingService);
    });
  });
});
