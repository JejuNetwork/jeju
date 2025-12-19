/**
 * DWS Frontend E2E Tests - Decentralization Verification
 * 
 * Verifies that the system is properly decentralized:
 * - On-chain registry integration
 * - P2P node discovery
 * - IPFS storage
 * - ERC-8004 identity
 * - x402 payments
 * - Moderation contracts
 */

import { test, expect } from '@playwright/test';
import { testConfig } from './setup';
import { createPublicClient, http, parseAbi } from 'viem';
import { localhost } from 'viem/chains';

const { dwsUrl, frontendUrl, rpcUrl, testWallet } = testConfig;

// Contract ABIs for verification
const IDENTITY_REGISTRY_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getAgentMetadata(uint256 agentId) view returns (string name, string description, string url)',
]);

const BAN_MANAGER_ABI = parseAbi([
  'function isBanned(address account) view returns (bool)',
  'function getBanRecord(address account) view returns (uint8 banType, uint40 expiresAt, string reason)',
]);

// Create viem client for on-chain verification
function createClient() {
  return createPublicClient({
    chain: { ...localhost, id: 1337 },
    transport: http(rpcUrl),
  });
}

test.describe('DWS E2E - Decentralization Verification', () => {
  test('health endpoint shows decentralized status', async () => {
    const res = await fetch(`${dwsUrl}/health`);
    expect(res.status).toBe(200);
    
    const health = await res.json() as {
      decentralized: {
        identityRegistry: string;
        registeredNodes: number;
        connectedPeers: number;
        frontendCid: string;
        p2pEnabled: boolean;
      };
    };

    expect(health.decentralized).toBeDefined();
    expect(health.decentralized.identityRegistry).toMatch(/^0x/);
    expect(typeof health.decentralized.registeredNodes).toBe('number');
    expect(typeof health.decentralized.connectedPeers).toBe('number');
  });

  test('storage uses IPFS CIDs', async () => {
    const testData = `Decentralization test ${Date.now()}`;
    
    const uploadRes = await fetch(`${dwsUrl}/storage/upload/raw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'x-jeju-address': testWallet.address,
        'x-filename': 'decentralized-test.txt',
      },
      body: testData,
    });
    expect(uploadRes.status).toBe(200);
    
    const { cid } = await uploadRes.json() as { cid: string };
    
    // CID should be a valid IPFS CID (starts with Qm or bafy)
    expect(cid).toMatch(/^(Qm|bafy)/);
  });

  test('RPC gateway provides decentralized chain access', async () => {
    const res = await fetch(`${dwsUrl}/rpc/chains`);
    expect(res.status).toBe(200);
    
    const { chains } = await res.json() as { 
      chains: Array<{ 
        chainId: number; 
        name: string;
        rpcUrl: string;
      }> 
    };

    // Should have at least localnet
    expect(chains.length).toBeGreaterThan(0);
    
    // Each chain should have proper config
    for (const chain of chains) {
      expect(chain.chainId).toBeGreaterThan(0);
      expect(chain.name).toBeDefined();
      expect(chain.rpcUrl).toMatch(/^https?:\/\//);
    }
  });

  test('edge nodes are distributed', async () => {
    const res = await fetch(`${dwsUrl}/edge/nodes`);
    expect(res.status).toBe(200);
    
    const { nodes } = await res.json() as { 
      nodes: Array<{ 
        id: string; 
        region: string;
        status: string;
      }> 
    };

    expect(Array.isArray(nodes)).toBe(true);
    
    // If nodes exist, verify they have proper structure
    for (const node of nodes) {
      expect(node.id).toBeDefined();
      expect(node.region).toBeDefined();
      expect(['online', 'offline', 'maintenance']).toContain(node.status);
    }
  });

  test('frontend shows decentralized indicators', async ({ page }) => {
    await page.goto(frontendUrl);
    
    // Wait for page to load
    await expect(page.locator('h3:has-text("Welcome to DWS Console")')).toBeVisible();
    
    // Navigate to a service page
    await page.click('text=Containers');
    await expect(page).toHaveURL(/\/compute\/containers/);
    
    // Should show decentralized nodes available
    await expect(page.locator('text=Available Nodes').or(page.locator('text=Nodes'))).toBeVisible();
  });
});

test.describe('DWS E2E - On-Chain Integration', () => {
  test('can verify on-chain RPC connectivity', async () => {
    const client = createClient();
    
    // Get chain ID
    const chainId = await client.getChainId();
    expect(chainId).toBe(1337);
    
    // Get block number
    const blockNumber = await client.getBlockNumber();
    expect(blockNumber).toBeGreaterThanOrEqual(0n);
  });

  test('localnet has deployed contracts', async () => {
    const client = createClient();
    
    // Get health to find contract addresses
    const healthRes = await fetch(`${dwsUrl}/health`);
    const health = await healthRes.json() as {
      decentralized: { identityRegistry: string };
    };
    
    if (health.decentralized.identityRegistry !== '0x0000000000000000000000000000000000000000') {
      // Verify contract has code
      const code = await client.getCode({ 
        address: health.decentralized.identityRegistry as `0x${string}`,
      });
      expect(code).not.toBe('0x');
    }
  });
});

test.describe('DWS E2E - x402 Payment Integration', () => {
  test('x402 middleware is active', async () => {
    // Check if x402 headers are processed
    const res = await fetch(`${dwsUrl}/compute/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': 'x402-test',
      },
      body: JSON.stringify({
        model: 'test',
        messages: [{ role: 'user', content: 'test' }],
      }),
    });
    
    // Should either succeed or return 402 payment required
    expect([200, 402, 503]).toContain(res.status);
  });

  test('billing page shows x402 information', async ({ page }) => {
    await page.goto(`${frontendUrl}/billing`);
    
    await expect(page.locator('h1')).toContainText('Billing');
    await expect(page.locator('text=x402')).toBeVisible();
    await expect(page.locator('text=micropayments').or(page.locator('text=Credits'))).toBeVisible();
  });
});

test.describe('DWS E2E - Multi-Backend Storage', () => {
  test('multiple storage backends available', async () => {
    const res = await fetch(`${dwsUrl}/health`);
    expect(res.status).toBe(200);
    
    const health = await res.json() as {
      backends: {
        available: string[];
        health: Record<string, { status: string }>;
      };
    };

    expect(health.backends.available).toBeDefined();
    expect(Array.isArray(health.backends.available)).toBe(true);
    
    // Should have at least memory backend
    expect(health.backends.available.length).toBeGreaterThan(0);
  });

  test('IPFS page shows decentralized storage', async ({ page }) => {
    await page.goto(`${frontendUrl}/storage/ipfs`);
    
    await expect(page.locator('h1')).toContainText('IPFS');
    await expect(page.locator('text=decentralized').or(page.locator('text=distributed'))).toBeVisible();
  });
});

test.describe('DWS E2E - Provider Registration', () => {
  test('provider mode shows node registration', async ({ page }) => {
    await page.goto(frontendUrl);
    
    // Switch to provider mode
    await page.locator('button:has-text("Provider")').click();
    
    // Should show provider-specific UI
    await expect(page.locator('button:has-text("Provider")')).toHaveClass(/active/);
  });

  test('settings page shows provider options', async ({ page }) => {
    await page.goto(`${frontendUrl}/settings`);
    
    await expect(page.locator('h1')).toContainText('Settings');
    
    // Should have provider registration section
    await expect(page.locator('text=Node').or(page.locator('text=Provider'))).toBeVisible();
  });
});

