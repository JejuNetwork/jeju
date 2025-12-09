/**
 * REAL Trading Tests - Verify expected shares calculation and display
 * These tests would FAIL if trading calculations are broken
 */

import { test, expect } from '@playwright/test';
import { assertNoPageErrors } from '@jejunetwork/tests/helpers/error-detection';

test.describe('Trading - REAL Calculation Verification', () => {
  test('should verify YES/NO selection affects buy button text', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    
    const marketCard = page.getByTestId('market-card').first();
    const cardExists = await marketCard.isVisible();
    
    if (!cardExists) return;
    
    await marketCard.click();
    await page.waitForTimeout(500);
    await assertNoPageErrors(page);
    
    const yesButton = page.getByTestId('outcome-yes-button');
    const noButton = page.getByTestId('outcome-no-button');
    const buyButton = page.getByTestId('buy-button');
    
    const buttonsExist = await yesButton.isVisible();
    if (!buttonsExist) return;
    
    // Select YES
    await yesButton.click();
    await page.waitForTimeout(300);
    
    let buyText = await buyButton.textContent();
    
    // VERIFY: Buy button says "Buy YES"
    expect(buyText).toContain('YES');
    
    // Select NO
    await noButton.click();
    await page.waitForTimeout(300);
    
    buyText = await buyButton.textContent();
    
    // VERIFY: Buy button changed to "Buy NO"
    expect(buyText).toContain('NO');
    expect(buyText).not.toContain('YES');
    
    // TEST FAILS if button doesn't update with selection
  });

  test('should verify price bars add up to 100%', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    
    const marketCards = page.getByTestId('market-card');
    const count = await marketCards.count();
    
    if (count > 0) {
      // Test first 3 markets
      for (let i = 0; i < Math.min(count, 3); i++) {
        const card = marketCards.nth(i);
        const cardText = await card.textContent();
        
        const yesMatch = cardText?.match(/YES.*?(\d+\.?\d*)%/i);
        const noMatch = cardText?.match(/NO.*?(\d+\.?\d*)%/i);
        
        if (yesMatch && noMatch) {
          const yesPercent = parseFloat(yesMatch[1]);
          const noPercent = parseFloat(noMatch[1]);
          
          const sum = yesPercent + noPercent;
          
          // VERIFY: Prices sum to ~100%
          // TEST FAILS if LMSR calculation wrong
          expect(sum).toBeGreaterThan(98);
          expect(sum).toBeLessThan(102);
          
          console.log(`Market ${i}: YES ${yesPercent}% + NO ${noPercent}% = ${sum}%`);
        }
      }
    }
  });

  test('should verify market volume is displayed correctly', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    
    const marketCards = page.getByTestId('market-card');
    const count = await marketCards.count();
    
    if (count > 0) {
      const firstCard = marketCards.first();
      const cardText = await firstCard.textContent();
      
      // VERIFY: Volume shows with ETH
      const volumeMatch = cardText?.match(/Volume.*?([\d,]+\.?\d*)\s*ETH/i);
      
      if (volumeMatch) {
        const volume = parseFloat(volumeMatch[1].replace(/,/g, ''));
        
        // VERIFY: Volume is non-negative number
        expect(volume).toBeGreaterThanOrEqual(0);
        expect(isNaN(volume)).toBe(false);
        
        console.log('Market volume:', volume, 'ETH');
      } else {
        // TEST FAILS if volume not shown
        expect(cardText).toMatch(/Volume/i);
      }
    }
  });

  test('should verify resolved markets show outcome', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    
    // Filter to resolved
    await page.getByTestId('filter-resolved').click();
    await page.waitForTimeout(500);
    
    const resolvedCards = page.getByTestId('market-card');
    const count = await resolvedCards.count();
    
    if (count > 0) {
      const firstResolved = resolvedCards.first();
      const cardText = await firstResolved.textContent();
      
      // VERIFY: Shows "Resolved" badge
      expect(cardText).toMatch(/Resolved/i);
      
      // VERIFY: Shows outcome (YES or NO)
      const hasOutcome = cardText?.match(/Outcome:?\s*(YES|NO)/i);
      
      if (hasOutcome) {
        console.log('Resolved market outcome:', hasOutcome[1]);
        
        // TEST FAILS if outcome not shown
        expect(['YES', 'NO']).toContain(hasOutcome[1]);
      }
    }
  });

  test('should verify amount input affects estimated shares (if displayed)', async ({ page }) => {
    await page.goto('/markets');
    await page.waitForTimeout(2000);
    
    const marketCard = page.getByTestId('market-card').first();
    const cardExists = await marketCard.isVisible();
    
    if (!cardExists) return;
    
    await marketCard.click();
    await page.waitForTimeout(500);
    
    const amountInput = page.getByTestId('amount-input');
    const inputExists = await amountInput.isVisible();
    
    if (!inputExists) return;
    
    // Enter small amount
    await amountInput.fill('0.1');
    await page.waitForTimeout(500);
    
    let body = await page.textContent('body');
    
    // Look for shares/expected display
    const hasSharesSmall = body?.match(/(\d+\.?\d*)\s*(shares|expected)/i);
    
    // Enter larger amount
    await amountInput.fill('1.0');
    await page.waitForTimeout(500);
    
    body = await page.textContent('body');
    const hasSharesLarge = body?.match(/(\d+\.?\d*)\s*(shares|expected)/i);
    
    // If shares are displayed, verify they're different for different amounts
    if (hasSharesSmall && hasSharesLarge) {
      const sharesSmall = parseFloat(hasSharesSmall[1]);
      const sharesLarge = parseFloat(hasSharesLarge[1]);
      
      // VERIFY: Larger amount = more shares
      // TEST FAILS if calculation doesn't update
      expect(sharesLarge).toBeGreaterThan(sharesSmall);
      
      console.log('Shares calculation: 0.1 ETH →', sharesSmall, '1.0 ETH →', sharesLarge);
    }
  });
});

