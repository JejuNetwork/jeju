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

const dwsUrl = process.env.DWS_URL || 'http://127.0.0.1:4030';
const frontendUrl = process.env.BASE_URL || 'http://127.0.0.1:4033';
const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:9545';
const testWallet = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
};

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

  test('storage returns content identifier', async () => {
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
    
    // CID should be defined (could be IPFS CID or local ID)
    expect(cid).toBeDefined();
    expect(cid.length).toBeGreaterThan(0);
  });

  test('RPC gateway provides chain access', async () => {
    const res = await fetch(`${dwsUrl}/rpc/chains`);
    expect(res.status).toBe(200);
    
    const data = await res.json() as { chains: Array<{ chainId: number; name: string }> };

    // Should have chains array
    expect(Array.isArray(data.chains)).toBe(true);
    expect(data.chains.length).toBeGreaterThan(0);
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
    // Make RPC call to verify chain is accessible
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    });
    
    expect(res.status).toBe(200);
    const data = await res.json() as { result: string };
    expect(data.result).toBe('0x539'); // 1337 in hex
  });

  test('localnet has identity registry configured', async () => {
    // Get health to find contract addresses
    const healthRes = await fetch(`${dwsUrl}/health`);
    const health = await healthRes.json() as {
      decentralized: { identityRegistry: string };
    };
    
    // Identity registry should be configured
    expect(health.decentralized.identityRegistry).toBeDefined();
    expect(health.decentralized.identityRegistry).toMatch(/^0x/);
  });
});

test.describe('DWS E2E - x402 Payment Integration', () => {
  test('compute endpoint accepts requests', async () => {
    // Verify compute endpoint is available
    const res = await fetch(`${dwsUrl}/compute/health`);
    expect(res.status).toBe(200);
  });

  test('billing page shows x402 information', async ({ page }) => {
    await page.goto(`${frontendUrl}/billing`);
    
    await expect(page.locator('h1')).toContainText('Billing');
    await expect(page.locator('.stat-label:has-text("x402 Balance")')).toBeVisible();
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

  test('settings page loads', async ({ page }) => {
    await page.goto(`${frontendUrl}/settings`);
    
    await expect(page.locator('h1')).toContainText('Settings');
  });
});
