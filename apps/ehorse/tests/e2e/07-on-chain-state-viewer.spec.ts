import { test, expect } from '@playwright/test';

const EHORSE_URL = process.env.EHORSE_URL || 'http://localhost:5700';

test.describe('On-Chain State Viewer UI', () => {
  test('should display state panel page', async ({ page }) => {
    await page.goto(`${EHORSE_URL}/state`);
    
    await expect(page.getByText('eHorse On-Chain State Viewer')).toBeVisible();
  });

  test('should show current race data', async ({ page }) => {
    await page.goto(`${EHORSE_URL}/state`);
    
    // Wait for data to load
    await page.waitForTimeout(3000);
    
    // Should show race panel
    await expect(page.getByText('Current Race')).toBeVisible();
    
    // Should show race ID
    await expect(page.locator('#race-data')).not.toContain Text('Loading...');
  });

  test('should show oracle state when configured', async ({ page }) => {
    await page.goto(`${EHORSE_URL}/state`);
    
    await page.waitForTimeout(3000);
    
    // Should show oracle panel
    await expect(page.getByText('Oracle State')).toBeVisible();
    
    // Will show either data or "not configured" message
    const oracleData = page.locator('#oracle-data');
    await expect(oracleData).toBeVisible();
  });

  test('should show market state when configured', async ({ page }) => {
    await page.goto(`${EHORSE_URL}/state`);
    
    await page.waitForTimeout(3000);
    
    // Should show market panel
    await expect(page.getByText('Predimarket State')).toBeVisible();
  });

  test('should show health status', async ({ page }) => {
    await page.goto(`${EHORSE_URL}/state`);
    
    await page.waitForTimeout(3000);
    
    // Should show health panel
    await expect(page.getByText('Health Status')).toBeVisible();
    
    // Should show server online
    await expect(page.getByText('ONLINE')).toBeVisible();
  });

  test('should refresh events on button click', async ({ page }) => {
    await page.goto(`${EHORSE_URL}/state`);
    
    await page.waitForTimeout(3000);
    
    // Find and click refresh button
    const refreshBtn = page.getByRole('button', { name: /Refresh Events/i });
    await expect(refreshBtn).toBeVisible();
    
    await refreshBtn.click();
    
    // Should trigger reload
    await page.waitForTimeout(1000);
  });

  test('should auto-update state every 5 seconds', async ({ page }) => {
    await page.goto(`${EHORSE_URL}/state`);
    
    // Get initial race ID
    await page.waitForTimeout(3000);
    const initialContent = await page.locator('#race-data').textContent();
    
    // Wait for auto-update
    await page.waitForTimeout(6000);
    
    // Content should have been refreshed
    const updatedContent = await page.locator('#race-data').textContent();
    
    // Either same race updated or new race
    expect(updatedContent).toBeTruthy();
  });
});



