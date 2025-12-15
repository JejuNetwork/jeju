/**
 * Solana Cross-Chain Tests
 * 
 * Tests Solana integration for cross-chain operations.
 * Requires: docker compose --profile solana up
 */

import { describe, test, expect, beforeAll } from 'bun:test';

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';

async function isSolanaRunning(): Promise<boolean> {
  try {
    const response = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getVersion',
        id: 1,
      }),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

describe('Solana Cross-Chain', () => {
  let solanaAvailable = false;

  beforeAll(async () => {
    solanaAvailable = await isSolanaRunning();
    if (!solanaAvailable) {
      console.log('Solana not running. Start with: docker compose -f packages/tests/docker-compose.test.yml --profile solana up -d');
    }
  });

  describe('Solana RPC', () => {
    test('should return version', async () => {
      if (!solanaAvailable) {
        console.log('Solana not available, skipping');
        return;
      }

      const response = await fetch(SOLANA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'getVersion',
          id: 1,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json() as { result: { 'solana-core': string } };
      expect(data.result['solana-core']).toBeDefined();
    });

    test('should return cluster nodes', async () => {
      if (!solanaAvailable) return;

      const response = await fetch(SOLANA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'getClusterNodes',
          id: 1,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json() as { result: unknown[] };
      expect(Array.isArray(data.result)).toBe(true);
    });

    test('should return genesis hash', async () => {
      if (!solanaAvailable) return;

      const response = await fetch(SOLANA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'getGenesisHash',
          id: 1,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json() as { result: string };
      expect(typeof data.result).toBe('string');
      expect(data.result.length).toBeGreaterThan(40);
    });

    test('should return slot', async () => {
      if (!solanaAvailable) return;

      const response = await fetch(SOLANA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'getSlot',
          id: 1,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json() as { result: number };
      expect(typeof data.result).toBe('number');
      expect(data.result).toBeGreaterThanOrEqual(0);
    });
  });
});

