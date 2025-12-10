import { test, expect } from '@playwright/test';

test.describe('ICO Presale App', () => {
  test('homepage loads correctly', async ({ page }) => {
    await page.goto('/');
    
    // Check header
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByText('Jeju')).toBeVisible();
    
    // Check hero section
    await expect(page.getByText('Jeju Token')).toBeVisible();
    await expect(page.getByText('Token Presale Live')).toBeVisible();
  });

  test('presale card displays correctly', async ({ page }) => {
    await page.goto('/');
    
    // Check presale card
    await expect(page.getByText('Participate')).toBeVisible();
    await expect(page.getByText('Progress')).toBeVisible();
    await expect(page.getByText('Connect Wallet')).toBeVisible();
  });

  test('countdown timer displays', async ({ page }) => {
    await page.goto('/');
    
    // Check countdown elements
    await expect(page.getByText('Days')).toBeVisible();
    await expect(page.getByText('Hours')).toBeVisible();
    await expect(page.getByText('Mins')).toBeVisible();
    await expect(page.getByText('Secs')).toBeVisible();
  });

  test('contribution input works', async ({ page }) => {
    await page.goto('/');
    
    // Find input and enter amount
    const input = page.locator('input[type="number"]');
    await input.fill('1');
    
    // Check that token calculation appears
    await expect(page.getByText('You receive')).toBeVisible();
    await expect(page.getByText('JEJU')).toBeVisible();
  });

  test('quick amount buttons work', async ({ page }) => {
    await page.goto('/');
    
    // Click 0.1 ETH button
    await page.getByRole('button', { name: '0.1' }).click();
    
    const input = page.locator('input[type="number"]');
    await expect(input).toHaveValue('0.1');
  });

  test('tokenomics section displays', async ({ page }) => {
    await page.goto('/');
    
    // Scroll to tokenomics
    await page.getByText('Tokenomics').scrollIntoViewIfNeeded();
    
    // Check allocation categories
    await expect(page.getByText('Presale')).toBeVisible();
    await expect(page.getByText('Ecosystem')).toBeVisible();
    await expect(page.getByText('Agent Council')).toBeVisible();
    await expect(page.getByText('Team')).toBeVisible();
    await expect(page.getByText('Liquidity')).toBeVisible();
    await expect(page.getByText('Community')).toBeVisible();
  });

  test('timeline section displays', async ({ page }) => {
    await page.goto('/');
    
    // Check timeline
    await expect(page.getByText('Timeline')).toBeVisible();
    await expect(page.getByText('Whitelist Registration')).toBeVisible();
    await expect(page.getByText('Token Generation Event')).toBeVisible();
  });

  test('utility section displays', async ({ page }) => {
    await page.goto('/');
    
    // Check utility cards
    await expect(page.getByText('Token Utility')).toBeVisible();
    await expect(page.getByText('Governance')).toBeVisible();
    await expect(page.getByText('Moderation')).toBeVisible();
  });

  test('footer has required links', async ({ page }) => {
    await page.goto('/');
    
    // Check footer
    await expect(page.getByRole('link', { name: /Whitepaper/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Documentation/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Source Code/i })).toBeVisible();
  });

  test('whitepaper page loads', async ({ page }) => {
    await page.goto('/whitepaper');
    
    // Check whitepaper content
    await expect(page.getByText('Jeju Token Whitepaper')).toBeVisible();
    await expect(page.getByText('Abstract')).toBeVisible();
    await expect(page.getByText('Regulatory Compliance')).toBeVisible();
    await expect(page.getByText('MiCA')).toBeVisible();
  });

  test('whitepaper table of contents links work', async ({ page }) => {
    await page.goto('/whitepaper');
    
    // Click on a TOC link
    await page.getByRole('link', { name: '4. Tokenomics' }).click();
    
    // Check we scrolled to the section
    await expect(page.locator('#tokenomics')).toBeInViewport();
  });

  test('responsive design - mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Main content should still be visible
    await expect(page.getByText('Jeju Token')).toBeVisible();
    await expect(page.getByText('Participate')).toBeVisible();
  });
});
