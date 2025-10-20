import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../../test/wallet-setup/jeju.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Swap Interactions with Synpress', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    
    await page.goto('/')
    
    const connectButton = page.getByRole('button', { name: /Connect Wallet/i })
    if (await connectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await connectButton.click()
      await page.waitForTimeout(1000)
      await metamask.connectToDapp()
    }
  })

  test('should navigate to swap page', async ({ page }) => {
    await page.goto('/swap');
    
    await expect(page.getByRole('heading', { name: /Swap Tokens/i })).toBeVisible();
  });

  test('should display token selectors', async ({ page }) => {
    await page.goto('/swap');
    
    // Should have token selection dropdowns
    const selectors = await page.locator('select').count();
    expect(selectors).toBeGreaterThanOrEqual(2);
  });

  test('should allow entering swap amount', async ({ page }) => {
    await page.goto('/swap');
    
    // Enter amount in input field
    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill('1.5');
    
    await expect(amountInput).toHaveValue('1.5');
  });

  test('should show swap button when connected', async ({ page }) => {
    await page.goto('/swap');
    
    // Swap button should be visible
    const swapButton = page.getByRole('button', { name: /Swap|Switch to Jeju/i });
    await expect(swapButton.first()).toBeVisible();
  });
});

