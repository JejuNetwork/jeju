import { test, expect } from '@playwright/test';

test.describe('ICO Presale App - UI Components', () => {
  test('homepage loads correctly', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Jeju Token' })).toBeVisible();
    await expect(page.getByText('Token Presale Live')).toBeVisible();
  });

  test('presale card displays correctly', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.getByText('Participate')).toBeVisible();
    await expect(page.getByText('Progress')).toBeVisible();
    await expect(page.getByText('Connect Wallet')).toBeVisible();
  });

  test('countdown timer displays', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.getByText('Days')).toBeVisible();
    await expect(page.getByText('Hours')).toBeVisible();
    await expect(page.getByText('Mins')).toBeVisible();
    await expect(page.getByText('Secs')).toBeVisible();
  });

  test('tokenomics section displays all allocations', async ({ page }) => {
    await page.goto('/');
    
    await page.getByRole('heading', { name: 'Tokenomics' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    
    // Check tokenomics allocations exist
    await expect(page.getByText('10%').first()).toBeVisible();
    await expect(page.getByText('30%').first()).toBeVisible();
  });

  test('timeline section displays all phases', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
    await expect(page.getByText('Whitelist Registration')).toBeVisible();
    await expect(page.getByText('DEX Listing')).toBeVisible();
  });

  test('utility section displays all utilities', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.getByRole('heading', { name: 'Token Utility' })).toBeVisible();
    // Check we have multiple utility cards  
    const utilityCards = page.locator('.bg-zinc-800\\/50').filter({ hasText: /Governance|Moderation|Services|Council/ });
    await expect(utilityCards).toHaveCount(4);
  });

  test('footer has required links', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.getByRole('link', { name: /Whitepaper/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Documentation/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Source Code/i })).toBeVisible();
  });
});

test.describe('ICO Presale App - Contribution Input', () => {
  test('contribution input calculates tokens', async ({ page }) => {
    await page.goto('/');
    
    const input = page.locator('input[type="number"]');
    await input.fill('1');
    await page.waitForTimeout(1000);
    
    await expect(page.getByText('You receive')).toBeVisible();
  });

  test('quick amount buttons work', async ({ page }) => {
    await page.goto('/');
    
    // Click 0.1 button
    await page.locator('button').filter({ hasText: /^0\.1$/ }).click();
    await expect(page.locator('input[type="number"]')).toHaveValue('0.1');
  });

  test('shows bonus for larger amounts', async ({ page }) => {
    await page.goto('/');
    
    const input = page.locator('input[type="number"]');
    await input.fill('5');
    await page.waitForTimeout(1000);
    
    // Should show bonus section
    await expect(page.getByText(/Bonus/)).toBeVisible();
  });

  test('shows total with bonus', async ({ page }) => {
    await page.goto('/');
    
    const input = page.locator('input[type="number"]');
    await input.fill('10');
    
    await expect(page.getByText('Total')).toBeVisible();
  });

  test('clears input correctly', async ({ page }) => {
    await page.goto('/');
    
    const input = page.locator('input[type="number"]');
    await input.fill('5');
    await expect(page.getByText('You receive')).toBeVisible();
    
    await input.clear();
    await expect(page.getByText('You receive')).not.toBeVisible();
  });
});

test.describe('ICO Presale App - Whitepaper', () => {
  test('whitepaper page loads', async ({ page }) => {
    await page.goto('/whitepaper');
    
    await expect(page.getByRole('heading', { name: 'Jeju Token Whitepaper' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Abstract/ })).toBeVisible();
  });

  test('table of contents is complete', async ({ page }) => {
    await page.goto('/whitepaper');
    
    const tocNav = page.locator('nav');
    await expect(tocNav.getByRole('link', { name: /Abstract/i })).toBeVisible();
    await expect(tocNav.getByRole('link', { name: /Tokenomics/i })).toBeVisible();
    await expect(tocNav.getByRole('link', { name: /Risk/i })).toBeVisible();
  });

  test('TOC navigation works', async ({ page }) => {
    await page.goto('/whitepaper');
    
    await page.locator('nav').getByRole('link', { name: /Tokenomics/i }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('#tokenomics')).toBeInViewport();
  });

  test('MiCA compliance section exists', async ({ page }) => {
    await page.goto('/whitepaper');
    
    await expect(page.getByRole('heading', { name: /Regulatory Compliance/ })).toBeVisible();
  });

  test('risk factors section exists', async ({ page }) => {
    await page.goto('/whitepaper');
    
    await expect(page.getByRole('heading', { name: /Risk Factors/ })).toBeVisible();
  });

  test('disclaimer is present', async ({ page }) => {
    await page.goto('/whitepaper');
    
    await expect(page.getByRole('heading', { name: 'Disclaimer' })).toBeVisible();
    // Check disclaimer content
    await expect(page.getByText('lose your entire investment')).toBeVisible();
  });
});

test.describe('ICO Presale App - Responsive Design', () => {
  test('mobile viewport - homepage', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    await expect(page.getByText('Jeju Token')).toBeVisible();
    await expect(page.getByText('Participate')).toBeVisible();
    await expect(page.getByText('Connect Wallet')).toBeVisible();
  });

  test('mobile viewport - whitepaper', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/whitepaper');
    
    await expect(page.getByRole('heading', { name: /Whitepaper/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Contents' })).toBeVisible();
  });

  test('tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    
    await expect(page.getByText('Jeju Token')).toBeVisible();
    await expect(page.getByText('Tokenomics')).toBeVisible();
  });

  test('desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    
    await expect(page.getByText('Jeju Token')).toBeVisible();
    await expect(page.getByText('Tokenomics')).toBeVisible();
    await expect(page.getByText('Timeline')).toBeVisible();
    await expect(page.getByText('Token Utility')).toBeVisible();
  });
});

test.describe('ICO Presale App - Navigation', () => {
  test('header navigation works', async ({ page }) => {
    await page.goto('/');
    
    await page.getByRole('link', { name: /Whitepaper/i }).first().click();
    await expect(page).toHaveURL(/\/whitepaper/);
  });

  test('footer navigation works', async ({ page }) => {
    await page.goto('/');
    
    const whitepaperLinks = page.getByRole('link', { name: /Whitepaper/i });
    await whitepaperLinks.last().click();
    await expect(page).toHaveURL(/\/whitepaper/);
  });

  test('external links have correct attributes', async ({ page }) => {
    await page.goto('/');
    
    const githubLink = page.getByRole('link', { name: /Code|Source/i }).first();
    await expect(githubLink).toHaveAttribute('target', '_blank');
    await expect(githubLink).toHaveAttribute('rel', /noopener/);
  });
});

test.describe('ICO Presale App - Accessibility', () => {
  test('page has proper heading structure', async ({ page }) => {
    await page.goto('/');
    
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
  });

  test('inputs have associated labels', async ({ page }) => {
    await page.goto('/');
    
    const input = page.locator('input[type="number"]');
    await expect(input).toBeVisible();
    
    // Check for label or placeholder
    const hasPlaceholder = await input.getAttribute('placeholder');
    const hasLabel = await page.getByText(/Contribution|Amount/i).isVisible();
    expect(hasPlaceholder || hasLabel).toBeTruthy();
  });

  test('buttons are keyboard accessible', async ({ page }) => {
    await page.goto('/');
    
    const connectButton = page.getByRole('button', { name: /Connect Wallet/i });
    await connectButton.focus();
    await expect(connectButton).toBeFocused();
  });
});
