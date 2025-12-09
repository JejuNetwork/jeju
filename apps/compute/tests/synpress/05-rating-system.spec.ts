/**
 * Rating System Tests
 * Tests rental rating flow and reputation display
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Rating Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should display rating modal elements', async ({ page }) => {
    // Open rating modal by navigating to it
    // First inject a completed rental
    await page.evaluate(() => {
      const modal = document.getElementById('rating-modal');
      if (modal) modal.classList.add('active');
    });

    const ratingModal = page.getByTestId('rating-modal');
    await expect(ratingModal).toHaveClass(/active/);

    // Check elements
    await expect(page.getByTestId('rating-stars')).toBeVisible();
    await expect(page.getByTestId('rating-review')).toBeVisible();
    await expect(page.getByTestId('submit-rating-btn')).toBeVisible();
  });

  test('should have 5 rating stars', async ({ page }) => {
    await page.evaluate(() => {
      const modal = document.getElementById('rating-modal');
      if (modal) modal.classList.add('active');
    });

    const stars = page.locator('.rating-star');
    await expect(stars).toHaveCount(5);
  });

  test('should highlight stars on click', async ({ page }) => {
    await page.evaluate(() => {
      const modal = document.getElementById('rating-modal');
      if (modal) modal.classList.add('active');
    });

    // Click 4th star
    const stars = page.locator('.rating-star');
    await stars.nth(3).click();

    // First 4 stars should be active
    for (let i = 0; i < 4; i++) {
      await expect(stars.nth(i)).toHaveClass(/active/);
    }
    // 5th star should not be active
    await expect(stars.nth(4)).not.toHaveClass(/active/);
  });

  test('should enable submit button after selecting rating', async ({ page }) => {
    await page.evaluate(() => {
      const modal = document.getElementById('rating-modal');
      if (modal) modal.classList.add('active');
    });

    const submitBtn = page.getByTestId('submit-rating-btn');
    
    // Initially disabled
    await expect(submitBtn).toBeDisabled();

    // Click a star
    await page.locator('.rating-star').first().click();

    // Now enabled
    await expect(submitBtn).toBeEnabled();
  });

  test('should close rating modal', async ({ page }) => {
    await page.evaluate(() => {
      const modal = document.getElementById('rating-modal');
      if (modal) modal.classList.add('active');
    });

    await expect(page.getByTestId('rating-modal')).toHaveClass(/active/);

    await page.getByTestId('close-rating-modal').click();

    await expect(page.getByTestId('rating-modal')).not.toHaveClass(/active/);
  });

  test('should allow adding review text', async ({ page }) => {
    await page.evaluate(() => {
      const modal = document.getElementById('rating-modal');
      if (modal) modal.classList.add('active');
    });

    const reviewInput = page.getByTestId('rating-review');
    await reviewInput.fill('Great service, fast GPUs!');
    await expect(reviewInput).toHaveValue('Great service, fast GPUs!');
  });
});

test.describe('Provider Reputation Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-card', { timeout: 10000 });
  });

  test('should show rating in provider card', async ({ page }) => {
    const firstCard = page.locator('.provider-card').first();
    const rating = firstCard.locator('.provider-rating');
    await expect(rating).toBeVisible();
    await expect(rating).toContainText('★');
  });

  test('should show rating count', async ({ page }) => {
    const firstCard = page.locator('.provider-card').first();
    const rating = firstCard.locator('.provider-rating');
    // Should show count in parentheses like (42)
    const text = await rating.textContent();
    expect(text).toMatch(/\(\d+\)/);
  });
});

