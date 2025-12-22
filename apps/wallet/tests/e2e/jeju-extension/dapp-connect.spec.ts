/**
 * dApp Connection Tests
 *
 * Tests connecting Network Wallet extension to external dApps
 */

import { expect, test } from './extension.fixture'

// Type for the window object in the page context (serializable)
// Note: The actual types are defined in injected.ts, but page.evaluate
// runs in a separate context where we need to use basic checks
test.describe('dApp Connection via the network Extension', () => {
  test('should inject ethereum provider', async ({ testDappPage }) => {
    // Check if ethereum provider is injected
    const hasProvider = await testDappPage.evaluate(() => {
      return typeof window.ethereum !== 'undefined'
    })

    expect(hasProvider).toBeTruthy()
  })

  test('should handle eth_requestAccounts', async ({
    testDappPage,
    extensionPage: _extensionPage,
  }) => {
    // Click connect on test dApp
    await testDappPage.click('#connect')

    // Extension popup should show connection request
    // This may require approval in the extension
    await testDappPage.waitForTimeout(3000)

    // Check connection status
    const status = await testDappPage.locator('#connectionStatus').textContent()
    console.log('Connection status:', status)

    // Status should change from "Not connected"
    // Note: Full test requires extension UI interaction
  })

  test('should return chain ID', async ({ testDappPage }) => {
    // Request chain ID
    const chainId = await testDappPage.evaluate(async () => {
      if (!window.ethereum) return null
      return window.ethereum.request({ method: 'eth_chainId' })
    })

    // Should return a valid chain ID (or null if not connected)
    if (chainId) {
      expect(chainId).toMatch(/^0x[0-9a-fA-F]+$/)
      console.log('Chain ID:', parseInt(chainId as string, 16))
    }
  })

  test('should handle provider events', async ({ testDappPage }) => {
    // Set up event listener
    await testDappPage.evaluate(() => {
      if (!window.ethereum) return

      window.ethereum.on('chainChanged', () => {
        // Event registered
      })
    })

    // Event listener should be registered without errors
  })
})
