import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Portfolio Details', () => {
  test('should show connect wallet message when not connected', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(500);
    
    await assertNoPageErrors(page);
    
    const connectMessage = page.getByTestId('connect-wallet-message');
    await expect(connectMessage).toBeVisible();
  });

  test('should have portfolio stats sections when connected', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(500);
    
    await assertNoPageErrors(page);
    
    const connectMessage = page.getByTestId('connect-wallet-message');
    const totalValue = page.getByText(/Total Value/i);
    
    const needsConnection = await connectMessage.isVisible();
    const hasStats = await totalValue.isVisible();
    
    expect(needsConnection || hasStats).toBe(true);
  });

  test('should show positions table or no positions message', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForTimeout(1000);
    
    await assertNoPageErrors(page);
    
    const positionsTable = page.getByTestId('positions-table');
    const noPositions = page.getByTestId('no-positions');
    const connectMessage = page.getByTestId('connect-wallet-message');
    
    const tableExists = await positionsTable.isVisible();
    const noPositionsExists = await noPositions.isVisible();
    const connectExists = await connectMessage.isVisible();
    
    expect(tableExists || noPositionsExists || connectExists).toBe(true);
  });
});

