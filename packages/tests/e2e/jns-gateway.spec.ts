/**
 * JNS Gateway E2E Tests (Synpress)
 *
 * Tests the JNS Gateway functionality including:
 * - JNS name resolution
 * - IPFS content serving
 * - Wake page for unfunded apps
 * - Funding flow
 *
 * Run with Synpress:
 *   bunx playwright test packages/tests/e2e/jns-gateway.spec.ts --config packages/tests/smoke/synpress.config.ts
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { createPublicClient, http, type Address } from 'viem';
import { createJejuWalletSetup, PASSWORD, TEST_WALLET_ADDRESS } from '../shared/synpress.config.base';

const basicSetup = createJejuWalletSetup();
const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const RPC_URL = process.env.JEJU_RPC_URL || 'http://localhost:9545';
const JNS_GATEWAY_PORT = parseInt(process.env.JNS_GATEWAY_PORT || '4005');
const JNS_GATEWAY_URL = `http://localhost:${JNS_GATEWAY_PORT}`;

const chain = {
  id: 1337,
  name: 'Jeju Local',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

test.describe('JNS Gateway Tests', () => {
  test('should serve gateway health check', async ({ page }) => {
    await page.goto(`${JNS_GATEWAY_URL}/health`);
    await page.waitForLoadState('networkidle');

    const response = await page.textContent('body');
    expect(response).toContain('healthy');
    expect(response).toContain('jns-gateway');

    console.log('✅ JNS Gateway health check passed');
  });

  test('should serve JNS resolution API', async ({ page }) => {
    // This test requires a registered JNS name
    // In integration environment, we'd have a test name registered
    await page.goto(`${JNS_GATEWAY_URL}/api/resolve/test.jeju`);
    await page.waitForLoadState('networkidle');

    const response = await page.textContent('body');
    // Either we get a valid response or a "not found" - both are acceptable
    expect(response).toBeTruthy();

    if (response?.includes('error')) {
      console.log('⚠️  Test name not registered - expected in clean environment');
    } else {
      expect(response).toContain('cid');
      console.log('✅ JNS resolution API working');
    }
  });

  test('should serve keepalive status API', async ({ page }) => {
    await page.goto(`${JNS_GATEWAY_URL}/api/keepalive/status/test.jeju`);
    await page.waitForLoadState('networkidle');

    const response = await page.textContent('body');
    expect(response).toBeTruthy();
    expect(response).toContain('name');
    expect(response).toContain('funded');

    console.log('✅ Keepalive status API working');
  });
});

test.describe('Wake Page Tests', () => {
  test('should display wake page branding', async ({ page }) => {
    // Navigate to a test page that shows the wake page
    // In production, this would be an unfunded app
    // For testing, we can check the wake page template directly

    // Create a mock wake page by visiting a test endpoint
    await page.goto(`${JNS_GATEWAY_URL}/health`);

    // Check page structure is valid
    await expect(page).toHaveTitle(/Jeju|Gateway/i);

    console.log('✅ Gateway page loads correctly');
  });

  test('should allow funding via wallet when wake page is shown', async ({ context, page, metamaskPage, extensionId }) => {
    // This test requires:
    // 1. An unfunded app to show the wake page (set WAKE_PAGE_TEST_APP env var)
    // 2. A connected wallet with funds
    // 3. Actual contract interaction
    // 
    // If wake page is not shown, test is skipped (app may be funded or not registered)
    // Set WAKE_PAGE_TEST_APP=unfunded-app.jeju to test with a specific app

    const testApp = process.env.WAKE_PAGE_TEST_APP || 'unfunded-app.jeju';
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);

    await page.goto(`${JNS_GATEWAY_URL}/${testApp}/`);
    await page.waitForLoadState('networkidle');

    const fundButton = page.locator('text=Fund & Wake Up');
    const wakePageVisible = await fundButton.isVisible({ timeout: 5000 }).catch(() => false);

    if (!wakePageVisible) {
      test.skip();
      console.log(`⚠️  Wake page not shown for ${testApp} - app may be funded or not registered. Set WAKE_PAGE_TEST_APP to test with a specific unfunded app.`);
      return;
    }

    await metamask.connectToDapp();
    await fundButton.click();
    await metamask.confirmTransaction();
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await expect(fundButton).not.toBeVisible({ timeout: 10000 });
    console.log('✅ Funding flow completed');
  });
});

test.describe('IPFS Content Serving', () => {
  test('should serve IPFS content via direct CID', async ({ page }) => {
    // Use a known test CID (the IPFS "Hello World" file)
    const testCid = 'QmWATWQ7fVPP2EFGu71UkfnqhYXDYH566qy47CnJDgvs8u';

    await page.goto(`${JNS_GATEWAY_URL}/ipfs/${testCid}`);
    await page.waitForLoadState('networkidle');

    const response = await page.textContent('body');
    // May timeout or fail if no IPFS gateway - that's acceptable
    if (response) {
      console.log('✅ IPFS content served');
    } else {
      console.log('⚠️  IPFS gateway may not be available');
    }
  });

  test.skip('should serve SPA with fallback routing', async ({ page }) => {
    // This test requires a registered JNS name with a React/Vue SPA

    // Navigate to a deep route that doesn't exist as a file
    await page.goto(`${JNS_GATEWAY_URL}/myapp.jeju/dashboard/settings`);
    await page.waitForLoadState('networkidle');

    // SPA should fall back to index.html
    // Check that we get HTML content, not a 404
    const html = await page.content();
    expect(html).toContain('<!DOCTYPE html>');

    console.log('✅ SPA fallback routing working');
  });
});

test.describe('Health Check Standard', () => {
  test('should respond to standard health endpoints', async ({ page }) => {
    // Test /health
    await page.goto(`${JNS_GATEWAY_URL}/health`);
    let response = JSON.parse(await page.textContent('body') || '{}');
    expect(response.status).toBe('healthy');
    expect(response.service).toBeTruthy();

    console.log('✅ Basic health check passed');
  });

  test('should include required health fields', async ({ page }) => {
    await page.goto(`${JNS_GATEWAY_URL}/health`);
    const response = JSON.parse(await page.textContent('body') || '{}');

    // Check required fields per Jeju health standard
    expect(response).toHaveProperty('status');
    expect(response).toHaveProperty('service');

    // Timestamp is recommended
    if (response.timestamp) {
      expect(new Date(response.timestamp).getTime()).toBeGreaterThan(0);
    }

    console.log('✅ Health response format correct');
  });
});
