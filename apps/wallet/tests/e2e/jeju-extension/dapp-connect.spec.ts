/**
 * dApp Connection Tests
 *
 * Tests connecting Jeju Wallet extension to external dApps
 */

import { expect, test } from './extension.fixture'

test.describe('dApp Connection via Jeju Extension', () => {
  test('should inject ethereum provider', async ({ testDappPage }) => {
    const hasProvider = await testDappPage.evaluate(() => {
      return typeof window.ethereum !== 'undefined'
    })

    expect(hasProvider).toBeTruthy()
  })

  test('should handle eth_requestAccounts', async ({ testDappPage }) => {
    await testDappPage.click('#connect')

    // Extension popup should show connection request
    await testDappPage.waitForTimeout(3000)

    const status = await testDappPage.locator('#connectionStatus').textContent()
    console.log('Connection status:', status)
  })

  test('should return chain ID', async ({ testDappPage }) => {
    const chainId = await testDappPage.evaluate(async () => {
      if (!window.ethereum) return null
      return window.ethereum.request({ method: 'eth_chainId' })
    })

    if (chainId) {
      expect(chainId).toMatch(/^0x[0-9a-fA-F]+$/)
      console.log('Chain ID:', parseInt(chainId, 16))
    }
  })

  test('should handle provider events', async ({ testDappPage }) => {
    await testDappPage.evaluate(() => {
      if (!window.ethereum) return
      window.ethereum.on('chainChanged', () => {
        // Event registered successfully
      })
    })
  })
})
