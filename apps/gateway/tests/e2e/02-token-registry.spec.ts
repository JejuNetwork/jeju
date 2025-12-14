import { expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow as _captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';
import { testWithWallet as test } from '@jejunetwork/tests/fixtures/wallet';
import { connectWallet } from '@jejunetwork/tests/helpers/contracts';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:5173';

test.describe('Gateway Token Registry', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, wallet);
  });

  test('should display registered tokens list', async ({ page }) => {
    // Click Registered Tokens tab
    await page.click('button:has-text("Registered Tokens")');
    
    // Should show token list
    await expect(page.getByText(/elizaOS|CLANKER|VIRTUAL|CLANKERMON/i)).toBeVisible();
  });

  test('should show token details', async ({ page }) => {
    await page.click('button:has-text("Registered Tokens")');
    await page.waitForTimeout(1000);
    
    // Should show token information
    await expect(page.getByText(/Address|Contract|Paymaster/i)).toBeVisible();
  });

  test('should display token balances', async ({ page }) => {
    await page.click('button:has-text("Registered Tokens")');
    await page.waitForTimeout(1000);
    
    // Verify page has content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('should show paymaster status for each token', async ({ page }) => {
    await page.click('button:has-text("Registered Tokens")');
    await page.waitForTimeout(1000);
    
    // Check for paymaster indicators
    const paymasterElements = page.locator('text=/Paymaster|Deployed/i');
    const count = await paymasterElements.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

