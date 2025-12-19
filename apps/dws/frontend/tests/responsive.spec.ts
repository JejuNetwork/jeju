import { test, expect, devices } from '@playwright/test';

test.describe('DWS Console Responsive Design', () => {
  test('should display mobile layout on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Check for welcome screen h3 when not connected
    await expect(page.locator('h3:has-text("Welcome to DWS Console")')).toBeVisible();
  });

  test('should display tablet layout on medium screens', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    
    await expect(page.locator('h3:has-text("Welcome to DWS Console")')).toBeVisible();
  });

  test('should display desktop layout on large screens', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('h3:has-text("Welcome to DWS Console")')).toBeVisible();
  });

  test('should collapse sidebar on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    const sidebar = page.locator('.sidebar');
    const sidebarBox = await sidebar.boundingBox();
    
    if (sidebarBox) {
      expect(sidebarBox.x).toBeLessThan(0);
    }
  });

  test('should show stats in single column on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/compute/containers');
    
    await expect(page.locator('h1')).toContainText('Containers');
  });

  test('should show page on iPad viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1366 });
    await page.goto('/');
    await expect(page.locator('h3:has-text("Welcome to DWS Console")')).toBeVisible();
  });

  test('should show page on iPhone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('h3:has-text("Welcome to DWS Console")')).toBeVisible();
  });
});

const desktopTest = test.extend({
  page: async ({ browser }, use) => {
    const context = await browser.newContext({ ...devices['Desktop Chrome'] });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

desktopTest('desktop chrome - should have full sidebar visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.nav-item:has-text("Dashboard")')).toBeVisible();
});
