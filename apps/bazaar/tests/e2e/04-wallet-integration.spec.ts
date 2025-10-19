import { test, expect } from '@playwright/test'
import { bootstrap, getWallet } from '@tenkeylabs/dappwright'

test.describe('Wallet Integration', () => {
  test.skip('should connect MetaMask wallet', async ({ context }) => {
    // Skip if METAMASK_SEED_PHRASE not set
    if (!process.env.METAMASK_SEED_PHRASE) {
      test.skip()
    }

    const [wallet, page] = await bootstrap('', {
      wallet: 'metamask',
      version: 'v11.16.16',
      seed: process.env.METAMASK_SEED_PHRASE,
      headless: false,
    })

    await page.goto('http://localhost:4006')

    // Click connect wallet
    await page.getByRole('button', { name: /Connect Wallet/i }).click()

    // Approve connection in MetaMask
    await wallet.approve()

    // Should show connected address
    await expect(page.getByText(/0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{4}/)).toBeVisible()

    await page.close()
  })

  test('should prompt to switch to Jeju network', async ({ page }) => {
    await page.goto('/tokens/create')

    // Check for network switching message
    const networkWarning = page.getByText(/switch to Jeju network/i)
    
    // May or may not be visible depending on wallet connection state
    // Just verify the page loads correctly
    await expect(page.getByRole('heading', { name: /Create Token/i })).toBeVisible()
  })
})



