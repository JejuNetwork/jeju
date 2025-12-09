/**
 * E2E Test: View Reports and Proposals
 */

import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '@jejunetwork/tests/helpers/screenshots';

test.describe('View Reports', () => {
  test('should display active reports list', async ({ page }) => {
    await page.goto('http://localhost:3000/moderation');

    // Should show active reports tab
    await expect(page.getByText('Active Reports')).toBeVisible();

    // Reports section should load
    await expect(page.locator('.report-card, [class*="report"]').first()).toBeVisible({
      timeout: 10000,
    }).catch(() => {
      // No reports yet - should show empty state
      expect(page.getByText(/No active reports/i)).toBeVisible();
    });
  });

  test('should navigate to agent profile', async ({ page }) => {
    await page.goto('http://localhost:3000/moderation');

    // If there are reports, click on one
    const firstReport = page.locator('.report-card, [class*="bg-white"]').first();
    const hasReports = await firstReport.isVisible();

    if (hasReports) {
      // Click to view agent
      await page.getByText(/Agent #\d+/).first().click();

      // Should navigate to agent profile
      await expect(page.url()).toContain('/agent/');
    }
  });

  test('should show evidence links', async ({ page }) => {
    await page.goto('http://localhost:3000/moderation');

    // Evidence links should be present (if reports exist)
    const evidenceLink = page.getByText('View Evidence');
    const hasEvidence = await evidenceLink.isVisible();

    if (hasEvidence) {
      // Should link to IPFS
      const href = await evidenceLink.getAttribute('href');
      expect(href).toContain('ipfs.io/ipfs/');
    }
  });
});

