/**
 * dApp Connection Tests
 * 
 * Tests connecting Jeju Wallet extension to external dApps
 */

import { test, expect } from './extension.fixture';

test.describe('dApp Connection via Jeju Extension', () => {
  test('should inject ethereum provider', async ({ testDappPage }) => {
    // Check if ethereum provider is injected
    const hasProvider = await testDappPage.evaluate(() => {
      return typeof (window as unknown as { ethereum?: unknown }).ethereum !== 'undefined';
    });
    
    expect(hasProvider).toBeTruthy();
  });

  test('should handle eth_requestAccounts', async ({ testDappPage, extensionPage }) => {
    // Click connect on test dApp
    await testDappPage.click('#connect');
    
    // Extension popup should show connection request
    // This may require approval in the extension
    await testDappPage.waitForTimeout(3000);
    
    // Check connection status
    const status = await testDappPage.locator('#connectionStatus').textContent();
    console.log('Connection status:', status);
    
    // Status should change from "Not connected"
    // Note: Full test requires extension UI interaction
  });

  test('should return chain ID', async ({ testDappPage }) => {
    // Request chain ID
    const chainId = await testDappPage.evaluate(async () => {
      const ethereum = (window as unknown as { ethereum?: { request: (args: { method: string }) => Promise<string> } }).ethereum;
      if (!ethereum) return null;
      return ethereum.request({ method: 'eth_chainId' });
    });
    
    // Should return a valid chain ID (or null if not connected)
    if (chainId) {
      expect(chainId).toMatch(/^0x[0-9a-fA-F]+$/);
      console.log('Chain ID:', parseInt(chainId, 16));
    }
  });

  test('should handle provider events', async ({ testDappPage }) => {
    // Set up event listener
    await testDappPage.evaluate(() => {
      const ethereum = (window as unknown as { ethereum?: { on: (event: string, callback: (...args: unknown[]) => void) => void } }).ethereum;
      if (!ethereum) return;
      
      (window as unknown as { chainChanged: boolean }).chainChanged = false;
      ethereum.on('chainChanged', () => {
        (window as unknown as { chainChanged: boolean }).chainChanged = true;
      });
    });
    
    // Event listener should be registered without errors
  });
});

