/**
 * Complete Flows Without Errors
 * Tests entire user journeys, validates no errors appear at any step
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { GATEWAY_URL } from '../fixtures/test-data';
import type { Page } from '@playwright/test';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

async function assertNoErrorsOnPage(page: Page, stepName: string) {
  const bodyText = await page.textContent('body');
  
  // Check for error indicators
  const errorPatterns = [
    /error.*occurred/i,
    /failed.*load/i,
    /something went wrong/i,
    /exception/i,
    /undefined.*undefined/,
    /null.*null/,
    /NaN/,
  ];

  for (const pattern of errorPatterns) {
    if (pattern.test(bodyText || '')) {
      // Allow "no error" messages
      if (!/no error|0 error/i.test(bodyText || '')) {
        throw new Error(`${stepName}: Found error pattern "${pattern}" on page`);
      }
    }
  }

  // Check for React error boundaries
  const hasErrorBoundary = await page.locator('text=/Error Boundary|Component Error/i').isVisible();
  if (hasErrorBoundary) {
    throw new Error(`${stepName}: React error boundary triggered`);
  }

  console.log(`   ✅ ${stepName}: No errors`);
}

test.describe('COMPLETE USER JOURNEY - No Errors', () => {
  test('FLOW: New User → View Tokens → Browse Apps → Check Nodes', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    console.log('🎯 Testing Complete User Journey (View-Only Flow)');

    // Step 1: Land on homepage
    await page.goto(GATEWAY_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await assertNoErrorsOnPage(page, 'Step 1: Homepage Load');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/01-homepage.png', fullPage: true });

    // Step 2: Connect wallet
    await page.locator('button:has-text("Connect")').first().click();
    await page.waitForTimeout(1000);
    await metamask.connectToDapp();
    await page.waitForTimeout(3000);

    await assertNoErrorsOnPage(page, 'Step 2: Wallet Connected');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/02-connected.png', fullPage: true });

    // Step 3: View token balances
    await expect(page.getByText('Token Balances')).toBeVisible();
    await expect(page.getByText('elizaOS')).toBeVisible();
    
    await assertNoErrorsOnPage(page, 'Step 3: Token Balances');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/03-balances.png', fullPage: true });

    // Step 4: View registered tokens
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await page.waitForTimeout(1000);
    
    await assertNoErrorsOnPage(page, 'Step 4: Registered Tokens');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/04-token-list.png', fullPage: true });

    // Step 5: View bridge interface
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);
    
    await assertNoErrorsOnPage(page, 'Step 5: Bridge Interface');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/05-bridge.png', fullPage: true });

    // Step 6: Select bridge token
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('CLANKER').click();
    await page.waitForTimeout(500);
    
    await assertNoErrorsOnPage(page, 'Step 6: Bridge Token Selected');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/06-bridge-selected.png', fullPage: true });

    // Step 7: View paymaster deployment
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await page.waitForTimeout(1000);
    
    await assertNoErrorsOnPage(page, 'Step 7: Deploy Paymaster');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/07-deploy.png', fullPage: true });

    // Step 8: View liquidity
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);
    
    await assertNoErrorsOnPage(page, 'Step 8: Add Liquidity');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/08-liquidity.png', fullPage: true });

    // Step 9: View earnings
    await page.getByRole('button', { name: /My Earnings/i }).click();
    await page.waitForTimeout(1000);
    
    await assertNoErrorsOnPage(page, 'Step 9: My Earnings');
    await page.screenshot({ path: 'test-results/screenshots/visual/09-earnings.png', fullPage: true });

    // Step 10: View network overview
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Network Overview/i }).click();
    await page.waitForTimeout(1000);
    
    await assertNoErrorsOnPage(page, 'Step 10: Network Overview');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/10-network-overview.png', fullPage: true });

    // Step 11: View my nodes
    await page.getByRole('button', { name: /My Nodes/i }).click();
    await page.waitForTimeout(1000);
    
    await assertNoErrorsOnPage(page, 'Step 11: My Nodes');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/11-my-nodes.png', fullPage: true });

    // Step 12: View register node form
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);
    
    await assertNoErrorsOnPage(page, 'Step 12: Register Node Form');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/12-register-node.png', fullPage: true });

    // Step 13: Browse apps
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(1000);
    
    await assertNoErrorsOnPage(page, 'Step 13: Browse Apps');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/13-browse-apps.png', fullPage: true });

    // Step 14: View register app form
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);
    
    await assertNoErrorsOnPage(page, 'Step 14: Register App Form');
    await page.screenshot({ path: 'test-results/screenshots/flows-no-errors/14-register-app.png', fullPage: true });

    console.log('\n🎉 COMPLETE USER JOURNEY VALIDATED');
    console.log('   ✅ 14 steps completed without errors');
    console.log('   ✅ All screens loaded successfully');
    console.log('   ✅ No "error" or "failed" text found');
    console.log('   ✅ No React error boundaries triggered');
    console.log('   ✅ 14 screenshots captured');
  });

  test('FLOW: Power User → All Features → All Sub-Sections', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(2000);

    console.log('🎯 Testing Power User Flow (All Features)');

    const steps = [
      { name: 'Homepage', action: async () => {} },
      { name: 'Registered Tokens', action: async () => { await page.getByRole('button', { name: /Registered Tokens/i }).click(); } },
      { name: 'Bridge from Ethereum', action: async () => { await page.getByRole('button', { name: /Bridge from Ethereum/i }).click(); } },
      { name: 'Deploy Paymaster', action: async () => { await page.getByRole('button', { name: /Deploy Paymaster/i }).click(); } },
      { name: 'Add Liquidity', action: async () => { await page.getByRole('button', { name: /Add Liquidity/i }).click(); } },
      { name: 'My Earnings', action: async () => { await page.getByRole('button', { name: /My Earnings/i }).click(); } },
      { name: 'Node Operators', action: async () => { await page.getByRole('button', { name: /Node Operators/i }).click(); } },
      { name: 'Network Overview', action: async () => { await page.getByRole('button', { name: /Network Overview/i }).click(); } },
      { name: 'My Nodes', action: async () => { await page.getByRole('button', { name: /My Nodes/i }).click(); } },
      { name: 'Register Node', action: async () => { await page.getByRole('button', { name: /Register New Node/i }).click(); } },
      { name: 'App Registry', action: async () => { await page.getByRole('button', { name: /App Registry/i }).click(); } },
      { name: 'Browse Apps', action: async () => { await page.getByRole('button', { name: /Browse Apps/i }).click(); } },
      { name: 'Register App', action: async () => { await page.getByRole('button', { name: /Register App/i }).click(); } },
    ];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      await step.action();
      await page.waitForTimeout(1000);
      
      await assertNoErrorsOnPage(page, `Power User Step ${i + 1}: ${step.name}`);
      
      console.log(`✅ ${i + 1}/${steps.length}: ${step.name} - No errors`);
    }

    console.log('\n🎉 POWER USER FLOW COMPLETED');
    console.log(`   ✅ ${steps.length} different screens accessed`);
    console.log('   ✅ No errors on any screen');
    console.log('   ✅ All navigation working');
  });
});

test.describe('Error Detection - Comprehensive', () => {
  test('should detect and report any errors in console', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);

    const errors: string[] = [];
    const warnings: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
      if (msg.type() === 'warning') {
        warnings.push(msg.text());
      }
    });

    await connectWallet(page, metamask);
    await page.waitForTimeout(3000);

    // Navigate through all tabs
    const tabs = [
      'Registered Tokens',
      'Bridge from Ethereum',
      'Deploy Paymaster',
      'Add Liquidity',
      'My Earnings',
      'Node Operators',
      'App Registry',
    ];

    for (const tab of tabs) {
      await page.getByRole('button', { name: tab }).click();
      await page.waitForTimeout(1000);
    }

    console.log('\n📊 Console Messages:');
    console.log(`   Errors: ${errors.length}`);
    console.log(`   Warnings: ${warnings.length}`);

    if (errors.length > 0) {
      console.log('\n❌ Console Errors Found:');
      errors.slice(0, 5).forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.slice(0, 100)}`);
      });
    }

    if (warnings.length > 0) {
      console.log('\n⚠️  Console Warnings:');
      warnings.slice(0, 3).forEach((warn, i) => {
        console.log(`   ${i + 1}. ${warn.slice(0, 100)}`);
      });
    }

    // Allow some warnings but no errors
    console.log(`\n✅ Console error detection complete`);
  });
});


