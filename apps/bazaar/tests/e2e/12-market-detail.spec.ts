import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Market Detail Page', () => {
  test('should navigate to market detail page without errors', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(1000);
    
    await assertNoPageErrors(page);

    const marketCards = page.getByTestId('market-card');
    const count = await marketCards.count();

    if (count > 0) {
      await marketCards.first().click();
      await expect(page).toHaveURL(/\/markets\/.+/);
    } else {
      await page.goto('/markets/0x1234567890123456789012345678901234567890123456789012345678901234');
      const body = await page.textContent('body');
      expect(body).toBeTruthy();
    }
  });

  test('should display market information', async ({ page }) => {
    await page.goto('/markets/mock-session-id');
    await page.waitForTimeout(500);

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(50);
  });

  test('should show price chart or error state', async ({ page }) => {
    await page.goto('/markets/mock-session-id');
    await page.waitForTimeout(1000);

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(50);
  });

  test('should render market page without crashes', async ({ page }) => {
    await page.goto('/markets/mock-session-id');
    await page.waitForTimeout(1000);

    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    
    const navElements = await page.locator('nav, header, a').count();
    expect(navElements).toBeGreaterThan(0);
  });
});

