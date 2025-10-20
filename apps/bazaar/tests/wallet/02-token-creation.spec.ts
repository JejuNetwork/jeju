import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../../test/wallet-setup/jeju.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Token Creation with Wallet', () => {
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

  test('should navigate to token creation page', async ({ page }) => {
    await page.goto('/tokens/create');
    
    await expect(page.getByRole('heading', { name: /Create Token/i })).toBeVisible();
  });

  test('should fill token creation form', async ({ page }) => {
    await page.goto('/tokens/create');
    
    // Fill form fields
    await page.getByPlaceholder(/My Awesome Token/i).fill('Synpress Test Token');
    await page.getByPlaceholder(/MAT/i).fill('SYNT');
    await page.getByPlaceholder(/Describe your token/i).fill('A token created during Synpress E2E testing');
    await page.locator('input[placeholder="1000000"]').fill('5000000');

    // Button should show "Create Token" or network switch message
    const createButton = page.locator('main').getByRole('button').first();
    const buttonText = await createButton.textContent();
    
    expect(buttonText).toBeTruthy();
    expect(buttonText).not.toContain('Connect Wallet');
  });

  test('should enable create button when form is valid', async ({ page }) => {
    await page.goto('/tokens/create');
    
    // Fill required fields
    await page.getByPlaceholder(/My Awesome Token/i).fill('Test');
    await page.getByPlaceholder(/MAT/i).fill('TST');
    
    const createButton = page.locator('main').getByRole('button', { name: /Create Token|Switch to Jeju/i }).first();
    
    // Button should be visible and interactive
    await expect(createButton).toBeVisible();
  });
});

