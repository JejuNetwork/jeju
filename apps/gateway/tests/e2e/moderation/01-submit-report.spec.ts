/**
 * E2E Test: Submit Report Flow
 * Tests complete report submission with wallet interaction
 */

import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';

test.describe('Submit Report Flow', () => {
  test('should submit report with evidence', async ({ page }) => {
    // Navigate to moderation page
    await page.goto('http://localhost:3000/moderation');

    // Should see moderation dashboard
    await expect(page.getByText('Moderation Dashboard')).toBeVisible();

    // Click "Submit Report" tab
    await page.getByRole('button', { name: /Submit Report/i }).click();

    // Fill target agent ID
    await page.getByPlaceholder('Enter agent ID').fill('123');

    // Select report type (Network Ban)
    await page.getByText('Network Ban').click();

    // Select severity (Medium)
    await page.getByText(/Medium.*3 day/).click();

    // Upload evidence
    // Note: File upload requires special handling
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'evidence.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake image data'),
    });

    // Wait for upload
    await expect(page.getByText(/Hash:/)).toBeVisible({ timeout: 5000 });

    // Fill details
    await page.getByPlaceholder(/Describe the violation/).fill('Test violation for E2E test');

    // Check bond display
    await expect(page.getByText(/0.01 ETH/)).toBeVisible();

    // Submit button should be enabled
    const submitButton = page.getByRole('button', { name: /Submit Report/ });
    await expect(submitButton).toBeEnabled();

    // Note: Actual transaction requires wallet connection and signing
    // In full E2E, would:
    // 1. Connect MetaMask
    // 2. Sign transaction
    // 3. Wait for confirmation
    // 4. Verify report created
  });

  test('should validate required fields', async ({ page }) => {
    await page.goto('http://localhost:3000/moderation');
    await page.getByRole('button', { name: /Submit Report/i }).click();

    // Try to submit without filling form
    const submitButton = page.getByRole('button', { name: /Submit Report/ });

    // Should be disabled without evidence
    await expect(submitButton).toBeDisabled();
  });

  test('should display bond requirements correctly', async ({ page }) => {
    await page.goto('http://localhost:3000/moderation');
    await page.getByRole('button', { name: /Submit Report/i }).click();

    // Select different severity levels
    await page.getByText(/Low.*7 day/).click();
    await expect(page.getByText('0.001 ETH')).toBeVisible();

    await page.getByText(/Medium.*3 day/).click();
    await expect(page.getByText('0.01 ETH')).toBeVisible();

    await page.getByText(/High.*1 day/).click();
    await expect(page.getByText('0.05 ETH')).toBeVisible();

    await page.getByText(/Critical.*Immediate/).click();
    await expect(page.getByText('0.1 ETH')).toBeVisible();
  });
});

