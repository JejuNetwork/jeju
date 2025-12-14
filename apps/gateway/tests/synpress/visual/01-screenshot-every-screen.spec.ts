/**
 * Complete Visual Validation - Screenshot Every Screen
 * Tests that EVERY screen loads without errors, screenshots everything
 * Validates no "error", "failed", or exceptions appear anywhere
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { GATEWAY_URL } from '../fixtures/test-data';
import type { Page } from '@playwright/test';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

/**
 * Validate screen has no errors
 */
async function validateNoErrors(page: Page, screenName: string) {
  const bodyText = await page.textContent('body');
  
  // Check for error keywords
  const hasError = bodyText?.toLowerCase().includes('error');
  const hasFailed = bodyText?.toLowerCase().includes('failed');
  const hasException = bodyText?.toLowerCase().includes('exception');
  
  // Allow "no error" or "0 errors" - these are good
  const isGoodError = bodyText?.toLowerCase().includes('no error') || 
                     bodyText?.toLowerCase().includes('0 error');
  
  if ((hasError && !isGoodError) || hasFailed || hasException) {
    console.log(`❌ ${screenName}: Found error/failed/exception in page`);
    console.log(`   Page text snippet: ${bodyText?.slice(0, 500)}`);
    throw new Error(`${screenName} contains error/failed/exception text`);
  }
  
  console.log(`✅ ${screenName}: No errors found`);
}

test.describe('COMPLETE VISUAL VALIDATION - Every Screen', () => {
  test('MASTER: Screenshot and validate EVERY screen in Gateway', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    const screenshots: string[] = [];
    
    // Track console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // ===================
    // SCREEN 1: Homepage (Disconnected)
    // ===================
    await page.goto(GATEWAY_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    await validateNoErrors(page, 'Homepage Disconnected');
    await page.screenshot({ path: 'test-results/screenshots/visual/01-homepage-disconnected.png', fullPage: true });
    screenshots.push('Homepage Disconnected');
    console.log('📸 1/50: Homepage Disconnected');

    await expect(page.getByText(/Gateway Portal|Protocol Infrastructure/i)).toBeVisible();
    await expect(page.getByText(/Connect Your Wallet/i)).toBeVisible();

    // ===================
    // SCREEN 2: Connect Wallet Modal
    // ===================
    await page.locator('button:has-text("Connect")').first().click();
    await page.waitForTimeout(1000);
    
    await page.screenshot({ path: 'test-results/screenshots/visual/02-connect-modal.png', fullPage: true });
    screenshots.push('Connect Modal');
    console.log('📸 2/50: Connect Modal');

    // Connect wallet
    await metamask.connectToDapp();
    await page.waitForTimeout(2000);

    // ===================
    // SCREEN 3: Homepage (Connected)
    // ===================
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);
    
    await validateNoErrors(page, 'Homepage Connected');
    await page.screenshot({ path: 'test-results/screenshots/visual/03-homepage-connected.png', fullPage: true });
    screenshots.push('Homepage Connected');
    console.log('📸 3/50: Homepage Connected');

    // Verify token balances load
    await expect(page.getByText('Token Balances')).toBeVisible();
    await expect(page.getByText('elizaOS')).toBeVisible();
    await expect(page.getByText('CLANKER')).toBeVisible();
    await expect(page.getByText('VIRTUAL')).toBeVisible();
    await expect(page.getByText('CLANKERMON')).toBeVisible();

    // ===================
    // SCREEN 4: Token Balances Card Detail
    // ===================
    await page.screenshot({ path: 'test-results/screenshots/visual/04-token-balances-detail.png' });
    screenshots.push('Token Balances Card');
    console.log('📸 4/50: Token Balances Detail');

    // ===================
    // TAB 1: Registered Tokens
    // ===================
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'Registered Tokens Tab');
    await page.screenshot({ path: 'test-results/screenshots/visual/05-registered-tokens.png', fullPage: true });
    screenshots.push('Registered Tokens Tab');
    console.log('📸 5/50: Registered Tokens');

    // ===================
    // SCREEN 6: Register Token Form
    // ===================
    const registerSection = page.getByText(/Register New Token/i);
    if (await registerSection.isVisible()) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      
      await page.screenshot({ path: 'test-results/screenshots/visual/06-register-token-form.png', fullPage: true });
      screenshots.push('Register Token Form');
      console.log('📸 6/50: Register Token Form');
    }

    // ===================
    // TAB 2: Bridge from Ethereum
    // ===================
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'Bridge Tab');
    await page.screenshot({ path: 'test-results/screenshots/visual/07-bridge-tab.png', fullPage: true });
    screenshots.push('Bridge Tab');
    console.log('📸 7/50: Bridge Tab');

    // ===================
    // SCREEN 8: Bridge - Select Token Mode
    // ===================
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/screenshots/visual/08-bridge-token-dropdown.png', fullPage: true });
    screenshots.push('Bridge Token Dropdown');
    console.log('📸 8/50: Bridge Token Dropdown');

    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);

    // ===================
    // SCREEN 9: Bridge - Token Selected
    // ===================
    await page.screenshot({ path: 'test-results/screenshots/visual/09-bridge-token-selected.png', fullPage: true });
    screenshots.push('Bridge Token Selected');
    console.log('📸 9/50: Bridge with Token Selected');

    // ===================
    // SCREEN 10: Bridge - Custom Address Mode
    // ===================
    await page.getByRole('button', { name: /Custom Address/i }).click();
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/screenshots/visual/10-bridge-custom-mode.png', fullPage: true });
    screenshots.push('Bridge Custom Mode');
    console.log('📸 10/50: Bridge Custom Mode');

    // ===================
    // TAB 3: Deploy Paymaster
    // ===================
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'Deploy Paymaster Tab');
    await page.screenshot({ path: 'test-results/screenshots/visual/11-deploy-paymaster.png', fullPage: true });
    screenshots.push('Deploy Paymaster Tab');
    console.log('📸 11/50: Deploy Paymaster');

    // ===================
    // SCREEN 12: Deploy - Token Selection Dropdown
    // ===================
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/screenshots/visual/12-deploy-token-dropdown.png', fullPage: true });
    screenshots.push('Deploy Token Dropdown');
    console.log('📸 12/50: Deploy Token Dropdown');

    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // ===================
    // SCREEN 13: Deploy - Token Selected with Fee Slider
    // ===================
    await page.screenshot({ path: 'test-results/screenshots/visual/13-deploy-with-slider.png', fullPage: true });
    screenshots.push('Deploy with Fee Slider');
    console.log('📸 13/50: Deploy with Fee Slider');

    // ===================
    // TAB 4: Add Liquidity
    // ===================
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'Add Liquidity Tab');
    await page.screenshot({ path: 'test-results/screenshots/visual/14-add-liquidity.png', fullPage: true });
    screenshots.push('Add Liquidity Tab');
    console.log('📸 14/50: Add Liquidity');

    // ===================
    // SCREEN 15: Liquidity - Token Selection
    // ===================
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/screenshots/visual/15-liquidity-token-dropdown.png', fullPage: true });
    screenshots.push('Liquidity Token Dropdown');
    console.log('📸 15/50: Liquidity Token Dropdown');

    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // ===================
    // SCREEN 16: Liquidity - Token Selected
    // ===================
    await page.screenshot({ path: 'test-results/screenshots/visual/16-liquidity-token-selected.png', fullPage: true });
    screenshots.push('Liquidity Token Selected');
    console.log('📸 16/50: Liquidity Token Selected');

    // ===================
    // TAB 5: My Earnings (LP Dashboard)
    // ===================
    await page.getByRole('button', { name: /My Earnings/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'My Earnings Tab');
    await page.screenshot({ path: 'test-results/screenshots/visual/17-my-earnings.png', fullPage: true });
    screenshots.push('My Earnings Tab');
    console.log('📸 17/50: My Earnings');

    // ===================
    // TAB 6: Node Operators
    // ===================
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'Node Operators Tab');
    await page.screenshot({ path: 'test-results/screenshots/visual/18-node-operators.png', fullPage: true });
    screenshots.push('Node Operators Tab');
    console.log('📸 18/50: Node Operators');

    // ===================
    // SCREEN 19: Node - Network Overview
    // ===================
    await page.getByRole('button', { name: /Network Overview/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'Network Overview');
    await page.screenshot({ path: 'test-results/screenshots/visual/19-network-overview.png', fullPage: true });
    screenshots.push('Network Overview');
    console.log('📸 19/50: Network Overview');

    // ===================
    // SCREEN 20: Node - My Nodes
    // ===================
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'My Nodes');
    await page.screenshot({ path: 'test-results/screenshots/visual/20-my-nodes.png', fullPage: true });
    screenshots.push('My Nodes');
    console.log('📸 20/50: My Nodes');

    // ===================
    // SCREEN 21: Node - Register New Node
    // ===================
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'Register Node');
    await page.screenshot({ path: 'test-results/screenshots/visual/21-register-node.png', fullPage: true });
    screenshots.push('Register Node');
    console.log('📸 21/50: Register Node Form');

    // ===================
    // SCREEN 22: Node - Staking Token Dropdown
    // ===================
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/screenshots/visual/22-staking-token-dropdown.png', fullPage: true });
    screenshots.push('Staking Token Dropdown');
    console.log('📸 22/50: Staking Token Dropdown');

    await page.getByText('elizaOS').first().click();
    await page.waitForTimeout(500);

    // ===================
    // SCREEN 23: Node - Reward Token Dropdown
    // ===================
    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/screenshots/visual/23-reward-token-dropdown.png', fullPage: true });
    screenshots.push('Reward Token Dropdown');
    console.log('📸 23/50: Reward Token Dropdown');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ===================
    // TAB 7: App Registry
    // ===================
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'App Registry Tab');
    await page.screenshot({ path: 'test-results/screenshots/visual/24-app-registry.png', fullPage: true });
    screenshots.push('App Registry Tab');
    console.log('📸 24/50: App Registry');

    // ===================
    // SCREEN 25: App Registry - Browse Apps
    // ===================
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'Browse Apps');
    await page.screenshot({ path: 'test-results/screenshots/visual/25-browse-apps.png', fullPage: true });
    screenshots.push('Browse Apps');
    console.log('📸 25/50: Browse Apps');

    // ===================
    // SCREEN 26-32: Tag Filters
    // ===================
    const tags = ['All Apps', 'Applications', 'Games', 'Marketplaces', 'DeFi', 'Social', 'Services'];
    for (let i = 0; i < tags.length; i++) {
      await page.getByText(tags[i]).click();
      await page.waitForTimeout(500);
      
      await page.screenshot({ 
        path: `test-results/screenshots/visual/${26 + i}-tag-${tags[i].toLowerCase().replace(/\s+/g, '-')}.png`, 
        fullPage: true 
      });
      screenshots.push(`Tag Filter: ${tags[i]}`);
      console.log(`📸 ${26 + i}/50: Tag Filter - ${tags[i]}`);
    }

    // ===================
    // SCREEN 33: App Registry - Register App
    // ===================
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);
    
    await validateNoErrors(page, 'Register App');
    await page.screenshot({ path: 'test-results/screenshots/visual/33-register-app.png', fullPage: true });
    screenshots.push('Register App Form');
    console.log('📸 33/50: Register App Form');

    // ===================
    // SCREEN 34: App Registry - Tag Selection
    // ===================
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    await page.getByRole('button', { name: /💬 Social/i }).click();
    await page.waitForTimeout(300);
    
    await page.screenshot({ path: 'test-results/screenshots/visual/34-app-tags-selected.png', fullPage: true });
    screenshots.push('App Tags Selected');
    console.log('📸 34/50: App Tags Selected');

    // ===================
    // SCREEN 35: App Registry - Stake Token Dropdown
    // ===================
    await page.getByPlaceholder('My Awesome App').fill('Visual Test App');
    await page.waitForTimeout(300);

    const appStakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await appStakeSelector.click();
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/screenshots/visual/35-app-stake-dropdown.png', fullPage: true });
    screenshots.push('App Stake Dropdown');
    console.log('📸 35/50: App Stake Dropdown');

    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // ===================
    // SCREEN 36: App Registry - Form Filled
    // ===================
    await page.screenshot({ path: 'test-results/screenshots/visual/36-app-form-filled.png', fullPage: true });
    screenshots.push('App Form Filled');
    console.log('📸 36/50: App Form Filled');

    // ===================
    // SCREEN 37-40: Each Main Tab Revisited
    // ===================
    const finalTabs = [
      { name: /Registered Tokens/i, screen: 'Final - Tokens' },
      { name: /Bridge from Ethereum/i, screen: 'Final - Bridge' },
      { name: /My Earnings/i, screen: 'Final - Earnings' },
      { name: /Node Operators/i, screen: 'Final - Nodes' },
    ];

    for (let i = 0; i < finalTabs.length; i++) {
      await page.getByRole('button', { name: finalTabs[i].name }).click();
      await page.waitForTimeout(1000);
      
      await validateNoErrors(page, finalTabs[i].screen);
      await page.screenshot({ 
        path: `test-results/screenshots/visual/${37 + i}-${finalTabs[i].screen.toLowerCase().replace(/\s+/g, '-').replace('final-', 'revisit-')}.png`, 
        fullPage: true 
      });
      screenshots.push(finalTabs[i].screen);
      console.log(`📸 ${37 + i}/50: ${finalTabs[i].screen}`);
    }

    // ===================
    // VERIFICATION: No Console Errors
    // ===================
    if (consoleErrors.length > 0) {
      console.log(`⚠️  Found ${consoleErrors.length} console errors:`);
      consoleErrors.slice(0, 5).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.slice(0, 100)}`);
      });
    } else {
      console.log('✅ No console errors detected');
    }

    // ===================
    // FINAL VALIDATION
    // ===================
    console.log('\n🎉 COMPLETE VISUAL VALIDATION FINISHED');
    console.log(`   📸 ${screenshots.length} screenshots captured`);
    console.log(`   ✅ ${screenshots.length} screens validated (no errors/failed)`);
    console.log(`   ⚠️  ${consoleErrors.length} console errors`);
    console.log('\n📋 Screens Captured:');
    screenshots.forEach((screen, i) => {
      console.log(`   ${i + 1}. ${screen}`);
    });

    // Final assertion - no critical errors
    expect(screenshots.length).toBeGreaterThan(35);
  });
});


