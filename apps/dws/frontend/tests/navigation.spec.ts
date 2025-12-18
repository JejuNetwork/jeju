import { test, expect } from '@playwright/test';

test.describe('DWS Console Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load welcome screen when not connected', async ({ page }) => {
    await expect(page.locator('h3')).toContainText('Welcome to DWS Console');
  });

  test('should navigate to Containers page', async ({ page }) => {
    await page.click('text=Containers');
    await expect(page).toHaveURL('/compute/containers');
    await expect(page.locator('h1')).toContainText('Containers');
  });

  test('should navigate to Workers page', async ({ page }) => {
    await page.click('text=Workers');
    await expect(page).toHaveURL('/compute/workers');
    await expect(page.locator('h1')).toContainText('Workers');
  });

  test('should navigate to Jobs page', async ({ page }) => {
    await page.click('text=Jobs');
    await expect(page).toHaveURL('/compute/jobs');
    await expect(page.locator('h1')).toContainText('Compute Jobs');
  });

  test('should navigate to Storage Buckets page', async ({ page }) => {
    await page.click('text=Buckets');
    await expect(page).toHaveURL('/storage/buckets');
    await expect(page.locator('h1')).toContainText('Storage Buckets');
  });

  test('should navigate to CDN page', async ({ page }) => {
    await page.click('text=CDN');
    await expect(page).toHaveURL('/storage/cdn');
    await expect(page.locator('h1')).toContainText('CDN');
  });

  test('should navigate to IPFS page', async ({ page }) => {
    await page.click('text=IPFS');
    await expect(page).toHaveURL('/storage/ipfs');
    await expect(page.locator('h1')).toContainText('IPFS Storage');
  });

  test('should navigate to Repositories page', async ({ page }) => {
    await page.click('text=Repositories');
    await expect(page).toHaveURL('/developer/repositories');
    await expect(page.locator('h1')).toContainText('Git Repositories');
  });

  test('should navigate to Packages page', async ({ page }) => {
    await page.click('text=Packages');
    await expect(page).toHaveURL('/developer/packages');
    await expect(page.locator('h1')).toContainText('Package Registry');
  });

  test('should navigate to Pipelines page', async ({ page }) => {
    await page.click('a:has-text("CI/CD")');
    await expect(page).toHaveURL('/developer/pipelines');
    await expect(page.locator('h1')).toContainText('CI/CD Pipelines');
  });

  test('should navigate to Inference page', async ({ page }) => {
    await page.click('text=Inference');
    await expect(page).toHaveURL('/ai/inference');
    await expect(page.locator('h1')).toContainText('AI Inference');
  });

  test('should navigate to Embeddings page', async ({ page }) => {
    await page.click('text=Embeddings');
    await expect(page).toHaveURL('/ai/embeddings');
    await expect(page.locator('h1')).toContainText('Embeddings');
  });

  test('should navigate to Keys page', async ({ page }) => {
    await page.click('a:has-text("Keys (KMS)")');
    await expect(page).toHaveURL('/security/keys');
    await expect(page.locator('h1')).toContainText('Key Management');
  });

  test('should navigate to Secrets page', async ({ page }) => {
    await page.click('text=Secrets');
    await expect(page).toHaveURL('/security/secrets');
    await expect(page.locator('h1')).toContainText('Secrets Vault');
  });

  test('should navigate to OAuth3 page', async ({ page }) => {
    await page.click('text=OAuth3');
    await expect(page).toHaveURL('/security/oauth3');
    await expect(page.locator('h1')).toContainText('OAuth3 Applications');
  });

  test('should navigate to RPC Gateway page', async ({ page }) => {
    await page.click('text=RPC Gateway');
    await expect(page).toHaveURL('/network/rpc');
    await expect(page.locator('h1')).toContainText('RPC Gateway');
  });

  test('should navigate to VPN page', async ({ page }) => {
    await page.click('a:has-text("VPN/Proxy")');
    await expect(page).toHaveURL('/network/vpn');
    await expect(page.locator('h1')).toContainText('VPN / Proxy');
  });

  test('should navigate to Marketplace page', async ({ page }) => {
    await page.click('text=Browse APIs');
    await expect(page).toHaveURL('/marketplace/browse');
    await expect(page.locator('h1')).toContainText('API Marketplace');
  });

  test('should navigate to Billing page', async ({ page }) => {
    await page.click('text=Billing');
    await expect(page).toHaveURL('/billing');
    await expect(page.locator('h1')).toContainText('Billing');
  });

  test('should navigate to Settings page', async ({ page }) => {
    await page.click('text=Settings');
    await expect(page).toHaveURL('/settings');
    await expect(page.locator('h1')).toContainText('Settings');
  });

  test('should have consumer/provider toggle buttons', async ({ page }) => {
    await expect(page.locator('button:has-text("Consumer")')).toBeVisible();
    await expect(page.locator('button:has-text("Provider")')).toBeVisible();
  });
});
