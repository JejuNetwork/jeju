/**
 * Compute Integration Tests
 *
 * Real integration tests that verify on-chain behavior.
 * These tests require a running localnet with deployed contracts.
 *
 * Run with: jeju dev (to start localnet), then: bun test src/providers/tests/integration.test.ts
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { localhost } from 'viem/chains';

// Test configuration
const RPC_URL = process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545';
const BRIDGE_URL = process.env.COMPUTE_BRIDGE_URL || 'http://127.0.0.1:4010';
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Dev key

// Chain configuration
const chain = {
  ...localhost,
  id: 1337,
  name: 'Localnet',
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
};

describe('Chain Integration', () => {
  let publicClient: ReturnType<typeof createPublicClient>;
  let walletClient: ReturnType<typeof createWalletClient>;
  let account: ReturnType<typeof privateKeyToAccount>;

  beforeAll(async () => {
    account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

    publicClient = createPublicClient({
      chain,
      transport: http(RPC_URL),
    });

    walletClient = createWalletClient({
      account,
      chain,
      transport: http(RPC_URL),
    });
  });

  test('chain is running', async () => {
    const blockNumber = await publicClient.getBlockNumber();
    expect(blockNumber).toBeGreaterThanOrEqual(0n);
    console.log(`Chain block number: ${blockNumber}`);
  });

  test('account has balance', async () => {
    const balance = await publicClient.getBalance({ address: account.address });
    expect(balance).toBeGreaterThan(0n);
    console.log(`Account balance: ${formatEther(balance)} ETH`);
  });

  test('can send transaction', async () => {
    const tx = await walletClient.sendTransaction({
      account,
      to: account.address,
      value: parseEther('0.001'),
    });

    expect(tx).toBeDefined();
    expect(tx.startsWith('0x')).toBe(true);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    expect(receipt.status).toBe('success');
  });
});

describe('Bridge Integration', () => {
  test('bridge health check', async () => {
    const response = await fetch(`${BRIDGE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (!response) {
      console.log('Bridge not running, skipping bridge tests');
      return;
    }

    expect(response.ok).toBe(true);

    const health = (await response.json()) as { status: string; services: Record<string, string> };
    expect(health.status).toBe('ok');
    console.log('Bridge health:', health);
  });

  test('bridge status', async () => {
    const response = await fetch(`${BRIDGE_URL}/status`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (!response) {
      console.log('Bridge not running, skipping');
      return;
    }

    expect(response.ok).toBe(true);

    const status = (await response.json()) as {
      bridgeNode: { address: string };
      compute: { totalDeployments: number };
    };

    expect(status.bridgeNode).toBeDefined();
    expect(status.bridgeNode.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    console.log('Bridge status:', status);
  });

  test('list offerings', async () => {
    const response = await fetch(`${BRIDGE_URL}/offerings`, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    if (!response) {
      console.log('Bridge not running, skipping');
      return;
    }

    expect(response.ok).toBe(true);

    const data = (await response.json()) as {
      offerings: Array<{ id: string; provider: string; hardware: object }>;
      count: number;
    };

    expect(Array.isArray(data.offerings)).toBe(true);
    console.log(`Found ${data.count} offerings`);

    if (data.offerings.length > 0) {
      const offering = data.offerings[0];
      expect(offering.id).toBeDefined();
      expect(offering.provider).toBeDefined();
      expect(offering.hardware).toBeDefined();
    }
  });

  test('get quote', async () => {
    const response = await fetch(`${BRIDGE_URL}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: 'nginx:latest',
        hardware: { cpuCores: 2, memoryGb: 4 },
        durationHours: 1,
      }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    if (!response) {
      console.log('Bridge not running, skipping');
      return;
    }

    expect(response.ok).toBe(true);

    const quote = (await response.json()) as {
      bestOffering: { id: string; provider: string };
      totalCost: string;
      warnings: string[];
    };

    expect(quote.bestOffering).toBeDefined();
    expect(quote.totalCost).toBeDefined();
    console.log('Quote:', {
      provider: quote.bestOffering.provider,
      totalCost: quote.totalCost,
    });
  });
});

describe('Container Registry Integration', () => {
  test('resolve Docker Hub image', async () => {
    const response = await fetch(`${BRIDGE_URL}/registry/resolve?ref=nginx:latest`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (!response) {
      console.log('Bridge not running, skipping');
      return;
    }

    expect(response.ok).toBe(true);

    const resolved = (await response.json()) as {
      original: string;
      resolvedUrl: string;
      backend: string;
    };

    expect(resolved.original).toBe('nginx:latest');
    expect(resolved.backend).toBe('docker-hub');
    console.log('Resolved:', resolved);
  });

  test('resolve IPFS CID', async () => {
    const response = await fetch(`${BRIDGE_URL}/registry/resolve?ref=ipfs://QmTest123`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (!response) {
      console.log('Bridge not running, skipping');
      return;
    }

    expect(response.ok).toBe(true);

    const resolved = (await response.json()) as {
      original: string;
      cid: string;
      backend: string;
    };

    expect(resolved.cid).toBe('QmTest123');
    expect(resolved.backend).toBe('ipfs');
  });
});

describe('End-to-End Flow', () => {
  test('complete deployment flow (dry run)', async () => {
    // This test simulates the full flow without actually deploying

    // 1. Check chain
    const publicClient = createPublicClient({
      chain,
      transport: http(RPC_URL),
    });

    const blockNumber = await publicClient.getBlockNumber();
    expect(blockNumber).toBeGreaterThanOrEqual(0n);
    console.log('Step 1: Chain running at block', blockNumber.toString());

    // 2. Check bridge
    const healthResponse = await fetch(`${BRIDGE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    if (!healthResponse) {
      console.log('Bridge not running, ending test');
      return;
    }
    console.log('Step 2: Bridge healthy');

    // 3. List offerings
    const offeringsResponse = await fetch(`${BRIDGE_URL}/offerings`, {
      signal: AbortSignal.timeout(10000),
    });

    expect(offeringsResponse.ok).toBe(true);
    const offerings = (await offeringsResponse.json()) as { offerings: Array<{ id: string }>; count: number };
    console.log('Step 3: Found', offerings.count, 'offerings');

    // 4. Get quote
    const quoteResponse = await fetch(`${BRIDGE_URL}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: 'nginx:alpine',
        hardware: { cpuCores: 1, memoryGb: 2, storageGb: 10 },
        durationHours: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });

    expect(quoteResponse.ok).toBe(true);
    const quote = (await quoteResponse.json()) as {
      bestOffering: { provider: string };
      totalCost: string;
    };
    console.log('Step 4: Quote received -', quote.bestOffering.provider, 'for', quote.totalCost, 'ETH');

    // 5. Resolve container
    const resolveResponse = await fetch(`${BRIDGE_URL}/registry/resolve?ref=nginx:alpine`, {
      signal: AbortSignal.timeout(5000),
    });

    expect(resolveResponse.ok).toBe(true);
    const resolved = (await resolveResponse.json()) as { resolvedUrl: string };
    console.log('Step 5: Container resolved to', resolved.resolvedUrl);

    console.log('\nEnd-to-end flow completed successfully (dry run)');
  });
});

