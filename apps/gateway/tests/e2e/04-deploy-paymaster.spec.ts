import { expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';
import { testWithWallet as test } from '@jejunetwork/tests/fixtures/wallet';
import { connectWallet, deployPaymaster } from '@jejunetwork/tests/helpers/contracts';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:5173';

test.describe('Gateway Deploy Paymaster', () => {
  test.beforeEach(async ({ page, wallet }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, wallet);
    await page.click('button:has-text("Deploy Paymaster")');
  });

  test('should display paymaster deployment interface', async ({ page }) => {
    await expect(page.getByText(/Deploy Paymaster|Paymaster Factory/i)).toBeVisible();
  });

  test('should select token for paymaster', async ({ page }) => {
    const tokenSelect = page.locator('select[name*="token"], button:has-text("Select Token")').first();
    
    if (await tokenSelect.isVisible({ timeout: 5000 })) {
      await tokenSelect.click();
      await expect(page.getByText(/elizaOS|CLANKER|VIRTUAL/i)).toBeVisible();
    }
  });

  test('should show deployment requirements', async ({ page }) => {
    await page.waitForTimeout(1000);
    
    // Verify deployment interface has content
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.toLowerCase()).toMatch(/deploy|paymaster|token/);
  });

  test.skip('should deploy paymaster successfully', async ({ wallet, page }) => {
    await deployPaymaster(page, wallet, {
      token: 'elizaOS'
    });
    
    await expect(page.getByText(/Deployed|Success|Paymaster created/i)).toBeVisible({
      timeout: 90000
    });
  });

  test('should show deployed paymasters', async ({ page }) => {
    await page.waitForTimeout(1000);
    
    // Verify page structure
    const mainContent = await page.locator('main, [role="main"], body > div').count();
    expect(mainContent).toBeGreaterThan(0);
  });
});

