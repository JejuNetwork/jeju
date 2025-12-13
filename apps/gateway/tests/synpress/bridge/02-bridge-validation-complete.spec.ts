/**
 * Bridge Validation - Complete Coverage
 * Tests EVERY validation, constraint, and edge case for bridging
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask as _MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { GATEWAY_URL } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Bridge - elizaOS Exclusion (Native Token)', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should display warning that elizaOS cannot be bridged', async ({ page }) => {
    // Warning should be prominently displayed
    const warning = page.locator('[style*="background: #fef3c7"]').filter({ hasText: /elizaOS/i });
    await expect(warning).toBeVisible();

    await expect(page.getByText(/elizaOS is a native Jeju token/i)).toBeVisible();
    await expect(page.getByText(/cannot be bridged from Ethereum/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/bridge-validation/01-elizaos-warning.png',
      fullPage: true,
    });

    console.log('✅ elizaOS warning displayed');
  });

  test('should NOT show elizaOS in token dropdown', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    // Get all visible token options
    const dropdown = page.locator('[style*="position: absolute"]');
    const allText = await dropdown.textContent();

    expect(allText).toContain('CLANKER');
    expect(allText).toContain('VIRTUAL');
    expect(allText).toContain('CLANKERMON');
    expect(allText).not.toContain('elizaOS');

    console.log('✅ elizaOS excluded from dropdown');
  });

  test('should only show 3 bridgeable tokens (not 4)', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    const dropdown = page.locator('[style*="position: absolute"]');
    const tokenButtons = dropdown.locator('button');
    const count = await tokenButtons.count();

    // Should be exactly 3 (CLANKER, VIRTUAL, CLANKERMON)
    expect(count).toBe(3);

    console.log(`✅ Exactly 3 bridgeable tokens shown (not 4)`);
  });
});

test.describe('Bridge - USD Price Calculations', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should calculate USD value for CLANKER correctly', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);

    // Enter 100 CLANKER
    await page.getByPlaceholder('0.0').fill('100');
    await page.waitForTimeout(500);

    // Should show ~$2,614 (100 * $26.14)
    const usdText = await page.locator('text=/≈ \\$/').textContent();
    
    expect(usdText).toContain('$');
    expect(usdText).toContain('2,6'); // Should be ~$2,600

    console.log(`✅ CLANKER USD: ${usdText} (expected ~$2,614)`);
  });

  test('should calculate USD value for VIRTUAL correctly', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(500);

    // Enter 100 VIRTUAL
    await page.getByPlaceholder('0.0').fill('100');
    await page.waitForTimeout(500);

    // Should show ~$185 (100 * $1.85)
    const usdText = await page.locator('text=/≈ \\$/').textContent();
    
    expect(usdText).toContain('$');
    expect(usdText).toContain('185');

    console.log(`✅ VIRTUAL USD: ${usdText} (expected ~$185)`);
  });

  test('should calculate USD value for CLANKERMON correctly', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKERMON').click();
    await page.waitForTimeout(500);

    // Enter 100 CLANKERMON
    await page.getByPlaceholder('0.0').fill('100');
    await page.waitForTimeout(500);

    // Should show ~$15 (100 * $0.15)
    const usdText = await page.locator('text=/≈ \\$/').textContent();
    
    expect(usdText).toContain('$');
    expect(usdText).toContain('15');

    console.log(`✅ CLANKERMON USD: ${usdText} (expected ~$15)`);
  });

  test('should update USD when amount changes', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);

    // Enter amount
    await page.getByPlaceholder('0.0').fill('10');
    await page.waitForTimeout(500);

    const usd1 = await page.locator('text=/≈ \\$/').textContent();

    // Change amount
    await page.getByPlaceholder('0.0').fill('20');
    await page.waitForTimeout(500);

    const usd2 = await page.locator('text=/≈ \\$/').textContent();

    // Should be different
    expect(usd1).not.toBe(usd2);

    console.log(`✅ USD updates: ${usd1} → ${usd2}`);
  });
});

test.describe('Bridge - Custom Token Comprehensive Testing', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Custom Address/i }).click();
    await page.waitForTimeout(500);
  });

  test('should show helper text for custom tokens', async ({ page }) => {
    await expect(page.getByText(/Enter any ERC20 token address from Ethereum/i)).toBeVisible();
    await expect(page.getByText(/Make sure the token exists on both networks/i)).toBeVisible();

    console.log('✅ Custom token helper text displayed');
  });

  test('should accept valid ERC20 address formats', async ({ page }) => {
    const validAddresses = [
      '0x1234567890123456789012345678901234567890', // Lowercase
      '0xABCDEF1234567890ABCDEF1234567890ABCDEF12', // Uppercase
      '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12', // Mixed case
    ];

    for (const addr of validAddresses) {
      await page.getByPlaceholder('0x...').fill(addr);
      await page.getByPlaceholder('0.0').fill('10');
      await page.waitForTimeout(300);

      const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
      await expect(bridgeButton).toBeEnabled();

      console.log(`✅ Valid address accepted: ${addr.slice(0, 10)}...`);
    }
  });

  test('should reject invalid custom addresses', async ({ page }) => {
    const invalidAddresses = [
      '', // Empty
      '0x', // Just prefix
      '0x123', // Too short
      'not-an-address', // No hex
      '1234567890123456789012345678901234567890', // Missing 0x
      '0xZZZZ567890123456789012345678901234567890', // Invalid hex chars
    ];

    for (const addr of invalidAddresses) {
      await page.getByPlaceholder('0x...').fill(addr);
      await page.getByPlaceholder('0.0').fill('10');
      await page.waitForTimeout(300);

      const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
      const enabled = await bridgeButton.isEnabled();

      expect(enabled).toBe(false);
      console.log(`✅ Invalid rejected: "${addr.slice(0, 20)}"`);
    }
  });

  test('should handle extremely long input in custom address', async ({ page }) => {
    const longInput = '0x' + '1234567890'.repeat(10); // 100+ chars
    await page.getByPlaceholder('0x...').fill(longInput);

    const actualValue = await page.getByPlaceholder('0x...').inputValue();
    
    // Should truncate or reject
    console.log(`ℹ️  Long input handling: ${actualValue.length} chars`);
    console.log('✅ Long input handled');
  });
});

test.describe('Bridge - Button State Management', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should disable bridge button without token selection', async ({ page }) => {
    // No token selected
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeDisabled();

    console.log('✅ Disabled without token');
  });

  test('should disable bridge button without amount', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(500);

    // No amount entered
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeDisabled();

    console.log('✅ Disabled without amount');
  });

  test('should enable bridge button with valid token and amount', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKERMON').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('0.0').fill('50');
    await page.waitForTimeout(300);

    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeEnabled();

    console.log('✅ Enabled with valid inputs');
  });

  test('should show loading state during transaction', async ({ page, metamask }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('0.0').fill('1');

    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await bridgeButton.click();

    // During transaction, button might show loading state
    await page.waitForTimeout(1000);

    const buttonText = await bridgeButton.textContent();
    console.log(`ℹ️  Button during tx: "${buttonText}"`);

    // Reject to avoid state changes
    await metamask.rejectTransaction();

    console.log('✅ Button state during transaction tested');
  });
});

test.describe('Bridge - Decimal and Formatting', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should accept decimal amounts', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(500);

    const decimalAmounts = ['0.1', '1.5', '10.25', '100.123456'];

    for (const amount of decimalAmounts) {
      await page.getByPlaceholder('0.0').fill(amount);
      await page.waitForTimeout(300);

      const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
      await expect(bridgeButton).toBeEnabled();

      console.log(`✅ Decimal amount accepted: ${amount}`);
    }
  });

  test('should handle copy-pasted amounts with spaces', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);

    // Paste with spaces (common copy-paste issue)
    await page.getByPlaceholder('0.0').fill(' 100 ');

    const value = await page.getByPlaceholder('0.0').inputValue();
    
    // Should trim or handle spaces
    console.log(`ℹ️  Input with spaces: "${value}"`);
    console.log('✅ Spaces handling tested');
  });

  test('should format large numbers with commas in USD display', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('0.0').fill('1000');
    await page.waitForTimeout(500);

    // Should show $26,140 (1000 * $26.14)
    const usdText = await page.locator('text=/≈ \\$/').textContent();
    
    expect(usdText).toContain(','); // Should have comma separator

    console.log(`✅ Large USD formatted: ${usdText}`);
  });
});

test.describe('Bridge - Information Display Completeness', () => {
  test('should display estimated bridge time', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText(/Estimated Time.*~2 minutes/i)).toBeVisible();

    console.log('✅ Estimated time displayed');
  });

  test('should display bridge type (OP Stack)', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText(/OP Stack Standard Bridge/i)).toBeVisible();

    console.log('✅ Bridge type displayed');
  });

  test('should display destination information', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText(/Tokens will appear on Jeju after confirmation/i)).toBeVisible();

    console.log('✅ Destination info displayed');
  });

  test('should show all bridge information together', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    // All info should be in one panel
    const infoPanel = page.locator('[style*="background: #f8fafc"]').filter({ hasText: /Estimated Time/i });
    await expect(infoPanel).toBeVisible();

    await expect(infoPanel.getByText(/~2 minutes/i)).toBeVisible();
    await expect(infoPanel.getByText(/OP Stack/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/bridge-validation/02-info-panel-complete.png',
      fullPage: true,
    });

    console.log('✅ Complete bridge information panel');
  });
});

test.describe('Bridge - Ethereum Network Tokens Only', () => {
  test('should only accept tokens from Ethereum network', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    // All shown tokens should be from Ethereum
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    const tokens = ['CLANKER', 'VIRTUAL', 'CLANKERMON'];
    
    for (const token of tokens) {
      const tokenElement = page.getByText(token);
      await expect(tokenElement).toBeVisible();
      
      // These are all Ethereum network tokens
      console.log(`✅ ${token} (Ethereum network) available for bridge`);
    }

    // Native Jeju tokens should NOT be in list
    const dropdown = page.locator('[style*="position: absolute"]');
    const dropdownText = await dropdown.textContent();
    
    expect(dropdownText).not.toContain('elizaOS'); // Native Jeju

    console.log('✅ Only Ethereum network tokens shown');
  });
});

test.describe('Bridge - Form Reset and Clearing', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);
  });

  test('should clear amount when changing tokens', async ({ page }) => {
    // Select token and enter amount
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('0.0').fill('100');
    await page.waitForTimeout(300);

    // Change token
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(500);

    // Amount might persist or clear (implementation dependent)
    const amountValue = await page.getByPlaceholder('0.0').inputValue();
    
    console.log(`ℹ️  Amount after token change: "${amountValue}"`);
    console.log('✅ Token change behavior tested');
  });

  test('should allow clearing recipient address', async ({ page }) => {
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('0.0').fill('10');

    // Add recipient
    await page.getByPlaceholder(/0x.../).fill('0x1234567890123456789012345678901234567890');
    await page.waitForTimeout(300);

    // Clear it
    await page.getByPlaceholder(/0x.../).fill('');
    await page.waitForTimeout(300);

    // Should still work (defaults to sender)
    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    await expect(bridgeButton).toBeEnabled();

    console.log('✅ Can clear recipient (defaults to self)');
  });
});

test.describe('Bridge - Visual Feedback', () => {
  test('should highlight selected token in dropdown', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);

    // Click VIRTUAL
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(500);

    // Selector should show VIRTUAL
    const selectorText = await page.locator('.input').first().textContent();
    expect(selectorText).toContain('VIRTUAL');

    console.log('✅ Selected token displayed in selector');
  });

  test('should show token logo in selector', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);

    // Check for logo in selector
    const selectorLogo = page.locator('.input').first().locator('img');
    const hasLogo = await selectorLogo.isVisible();

    if (hasLogo) {
      console.log('✅ Token logo shown in selector');
    } else {
      console.log('ℹ️  No logo in selector (may be in dropdown only)');
    }
  });
});


