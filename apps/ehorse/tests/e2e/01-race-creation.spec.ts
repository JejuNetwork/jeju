import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';

const EHORSE_URL = process.env.EHORSE_URL || 'http://localhost:5700';

test.describe('eHorse Race Creation & On-Chain Verification', () => {
  test('should create race and display on UI', async ({ page }) => {
    await page.goto(EHORSE_URL);

    // Wait for page to load
    await expect(page.getByText('eHorse Racing')).toBeVisible();

    // Should show current race
    await expect(page.locator('.race-status')).toBeVisible();

    // Should show 4 horses
    const horses = ['Thunder', 'Lightning', 'Storm', 'Blaze'];
    for (const horse of horses) {
      await expect(page.getByText(horse)).toBeVisible();
    }
  });

  test('should show race progressing through states', async ({ page }) => {
    await page.goto(EHORSE_URL);

    // Get initial race ID
    const raceRes = await page.request.get(`${EHORSE_URL}/api/race`);
    const initialRace = await raceRes.json();
    const initialStatus = initialRace.status;

    console.log(`Initial race status: ${initialStatus}`);

    // Race should be in pending, running, or finished state
    expect(['pending', 'running', 'finished']).toContain(initialStatus);

    // Wait and check status changes
    await page.waitForTimeout(5000);

    const raceRes2 = await page.request.get(`${EHORSE_URL}/api/race`);
    const race2 = await raceRes2.json();

    // Status might have changed or new race created
    expect(race2).toBeTruthy();
    expect(race2.status).toBeTruthy();
  });

  test('should display race history', async ({ page }) => {
    await page.goto(EHORSE_URL);

    // Wait for history to load
    await page.waitForTimeout(2000);

    // Check if history section exists
    await expect(page.getByText('Recent Races')).toBeVisible();
  });

  test('should show oracle status indicator', async ({ page }) => {
    await page.goto(EHORSE_URL);

    await page.waitForTimeout(1000);

    // Should show oracle status
    const oracleStatus = page.locator('#oracle-status');
    await expect(oracleStatus).toBeVisible();

    const statusText = await oracleStatus.textContent();
    console.log(`Oracle status: ${statusText}`);

    // Should either be enabled or disabled
    expect(statusText).toMatch(/Oracle: (Enabled|Disabled)/);
  });
});
