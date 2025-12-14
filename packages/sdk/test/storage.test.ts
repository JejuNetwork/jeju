/**
 * Storage Module Tests
 */

import { describe, test, expect } from 'bun:test';
import { createJejuClient, type JejuClient } from '../src';
import { generatePrivateKey } from 'viem/accounts';

describe('Storage Module', () => {
  test('estimateCost calculates correctly', async () => {
    const client = await createJejuClient({
      network: 'localnet',
      privateKey: generatePrivateKey(),
      smartAccount: false,
    });

    // 1 GB for 1 month on hot tier
    const cost = client.storage.estimateCost(1024 * 1024 * 1024, 1, 'hot');
    expect(cost).toBeGreaterThan(0n);
  });

  test('getGatewayUrl returns valid URL', async () => {
    const client = await createJejuClient({
      network: 'localnet',
      privateKey: generatePrivateKey(),
      smartAccount: false,
    });

    const cid = 'QmTest123456789abcdefghijklmnopqrstuvwxyz';
    const url = client.storage.getGatewayUrl(cid);
    expect(url).toContain('/ipfs/');
    expect(url).toContain(cid);
  });
});

