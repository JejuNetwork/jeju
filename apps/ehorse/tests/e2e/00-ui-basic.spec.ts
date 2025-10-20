/**
 * Basic UI Test - Verify eHorse loads and displays correctly
 */

import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';

const EHORSE_URL = process.env.EHORSE_URL || 'http://localhost:5700';

test.describe('eHorse Basic UI', () => {
  test('should load main page and display all horses', async ({ page }) => {
    console.log('📱 Loading eHorse UI...');
    await page.goto(EHORSE_URL);
    
    // Check title
    await expect(page).toHaveTitle(/eHorse Racing/);
    console.log('✅ Page title correct');
    
    // Check header
    await expect(page.getByText('🐴 eHorse Racing')).toBeVisible();
    await expect(page.getByText('Minimal Horse Racing for Prediction Markets')).toBeVisible();
    console.log('✅ Header displayed');
    
    // Check all horses are displayed (using horse cards)
    await expect(page.locator('.horse-name', { hasText: 'Thunder' })).toBeVisible();
    await expect(page.locator('.horse-name', { hasText: 'Lightning' })).toBeVisible();
    await expect(page.locator('.horse-name', { hasText: 'Storm' })).toBeVisible();
    await expect(page.locator('.horse-name', { hasText: 'Blaze' })).toBeVisible();
    console.log('✅ All 4 horses displayed');
    
    // Check horse cards exist
    const horseCards = page.locator('.horse-card');
    await expect(horseCards).toHaveCount(4);
    console.log('✅ 4 horse cards rendered');
    
    // Check race status element
    const raceStatus = page.locator('#race-status');
    await expect(raceStatus).toBeVisible();
    const statusText = await raceStatus.textContent();
    console.log(`Race status: ${statusText}`);
    
    // Check betting info
    await expect(page.getByText('Want to bet on the races?')).toBeVisible();
    console.log('✅ Betting info displayed');
    
    // Check history section
    await expect(page.getByText('Recent Races')).toBeVisible();
    console.log('✅ History section present');
    
    // Take screenshot
    await page.screenshot({ path: 'test-results/ui-loaded.png', fullPage: true });
    console.log('📸 Screenshot saved');
    
    console.log('\n✅ UI BASIC TEST PASSED!');
  });

  test('should display race status from API', async ({ page }) => {
    console.log('🔍 Testing API integration...');
    
    // Test API endpoint directly
    const response = await page.request.get(`${EHORSE_URL}/api/race`);
    expect(response.ok()).toBeTruthy();
    
    const race = await response.json();
    console.log('Race data:', race);
    
    expect(race.id).toBeTruthy();
    expect(race.horses).toHaveLength(4);
    expect(['pending', 'running', 'grace-period', 'finished']).toContain(race.status);
    console.log(`✅ API returns valid race data (status: ${race.status})`);
    
    // Now check UI reflects API data
    await page.goto(EHORSE_URL);
    await page.waitForTimeout(1000);
    
    // UI should show the status
    const statusEl = page.locator('.race-status');
    await expect(statusEl).toBeVisible();
    console.log('✅ Race status displayed in UI');
  });

  test('should have working health endpoint', async ({ page }) => {
    console.log('🏥 Testing health endpoint...');
    
    const response = await page.request.get(`${EHORSE_URL}/health`);
    expect(response.ok()).toBeTruthy();
    
    const health = await response.json();
    console.log('Health:', health);
    
    expect(health.status).toBe('ok');
    expect(health.service).toBe('ehorse-tee');
    expect(health.mode).toBe('tee');
    expect(health.contest).toBe(true);
    console.log('✅ Health check passed');
  });
});

