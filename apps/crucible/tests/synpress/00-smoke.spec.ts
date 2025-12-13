/**
 * Crucible Smoke Tests
 * Basic tests to verify the UI loads correctly
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Smoke Tests', () => {
  test('should load the crucible dashboard', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify page title
    await expect(page).toHaveTitle(/Crucible/);
  });

  test('should show health status as healthy', async ({ page }) => {
    const response = await page.request.get('/health');
    const data = await response.json();
    
    expect(data.status).toBe('healthy');
    expect(data.service).toBe('crucible');
  });

  test('should list available character templates', async ({ page }) => {
    const response = await page.request.get('/api/v1/characters');
    const data = await response.json();
    
    expect(data.characters).toBeDefined();
    expect(data.characters.length).toBeGreaterThan(0);
    
    // Verify specific characters exist
    const ids = data.characters.map((c: { id: string }) => c.id);
    expect(ids).toContain('project-manager');
    expect(ids).toContain('red-team');
    expect(ids).toContain('blue-team');
  });

  test('should return info endpoint', async ({ page }) => {
    const response = await page.request.get('/info');
    const data = await response.json();
    
    expect(data.service).toBe('crucible');
    expect(data.version).toBe('1.0.0');
    expect(data.contracts).toBeDefined();
  });
});
