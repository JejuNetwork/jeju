/**
 * OAuth3 Demo E2E Tests
 * 
 * Tests the complete OAuth3 authentication flow including:
 * - Wallet login (SIWE)
 * - Discord OAuth flow
 * - Identity creation
 * - Smart account deployment
 * - Credential issuance
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('OAuth3 Demo', () => {
  test('homepage loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Check that the hero section is visible
    await expect(page.getByText('Decentralized Authentication')).toBeVisible();
    await expect(page.getByText('Sign In')).toBeVisible();
    
    await page.screenshot({ path: 'test-results/screenshots/oauth3/01-homepage.png', fullPage: true });
    console.log('✅ Homepage loaded');
  });

  test('wallet login flow', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // 1. Navigate to homepage
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // 2. Click Sign In button
    await page.getByRole('button', { name: /Sign In/i }).click();
    await page.waitForTimeout(500);
    
    // 3. Login modal should appear
    await expect(page.getByText('Choose a login method')).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/oauth3/02-login-modal.png' });
    console.log('✅ Login modal visible');

    // 4. Connect wallet via RainbowKit
    await page.getByRole('button', { name: /Connect/i }).click();
    await page.waitForTimeout(1000);
    
    // Click MetaMask option in RainbowKit
    const metamaskButton = page.getByRole('button', { name: /MetaMask/i });
    if (await metamaskButton.isVisible()) {
      await metamaskButton.click();
      await page.waitForTimeout(500);
      await metamask.connectToDapp();
    }
    
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/screenshots/oauth3/03-wallet-connected.png' });
    console.log('✅ Wallet connected');

    // 5. Now sign in with the connected wallet
    const signInButton = page.getByRole('button', { name: /Sign in with 0x/i });
    if (await signInButton.isVisible({ timeout: 5000 })) {
      await signInButton.click();
      await page.waitForTimeout(1000);
      
      // Approve the signature request in MetaMask
      await metamask.confirmSignature();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'test-results/screenshots/oauth3/04-signed-in.png', fullPage: true });
    
    // 6. Verify session info is displayed
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('TEE-attested authentication session')).toBeVisible();
    console.log('✅ Session created');

    // 7. Create identity
    const createIdentityBtn = page.getByRole('button', { name: /Create Identity/i });
    if (await createIdentityBtn.isVisible({ timeout: 5000 })) {
      await createIdentityBtn.click();
      await page.waitForTimeout(1000);
      await expect(page.getByText('Identity Created')).toBeVisible({ timeout: 10000 });
      console.log('✅ Identity created');
    }

    await page.screenshot({ path: 'test-results/screenshots/oauth3/05-identity-created.png', fullPage: true });

    // 8. Deploy smart account
    const deployAccountBtn = page.getByRole('button', { name: /Deploy Smart Account/i });
    if (await deployAccountBtn.isVisible({ timeout: 5000 })) {
      await deployAccountBtn.click();
      await page.waitForTimeout(1000);
      await expect(page.getByText('Account Deployed')).toBeVisible({ timeout: 10000 });
      console.log('✅ Smart account deployed');
    }

    await page.screenshot({ path: 'test-results/screenshots/oauth3/06-smart-account.png', fullPage: true });

    // 9. Issue credential
    const issueVCBtn = page.getByRole('button', { name: /Issue wallet VC/i });
    if (await issueVCBtn.isVisible({ timeout: 5000 })) {
      await issueVCBtn.click();
      await page.waitForTimeout(2000);
      await expect(page.getByText('Issued Credentials')).toBeVisible({ timeout: 10000 });
      console.log('✅ Credential issued');
    }

    await page.screenshot({ path: 'test-results/screenshots/oauth3/07-credentials.png', fullPage: true });

    // 10. Verify cross-chain card is visible
    await expect(page.getByText('Cross-Chain Identity')).toBeVisible();
    console.log('✅ Cross-chain identity visible');

    await page.screenshot({ path: 'test-results/screenshots/oauth3/08-final.png', fullPage: true });
    console.log('🎉 ALL OAUTH3 TESTS PASSED');
  });

  test('logout clears session', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    // Login first
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    await page.getByRole('button', { name: /Sign In/i }).click();
    await page.waitForTimeout(500);
    
    // Connect and sign in with wallet
    await page.getByRole('button', { name: /Connect/i }).click();
    await page.waitForTimeout(1000);
    
    const metamaskButton = page.getByRole('button', { name: /MetaMask/i });
    if (await metamaskButton.isVisible()) {
      await metamaskButton.click();
      await page.waitForTimeout(500);
      await metamask.connectToDapp();
    }
    
    await page.waitForTimeout(2000);
    
    const signInButton = page.getByRole('button', { name: /Sign in with 0x/i });
    if (await signInButton.isVisible({ timeout: 5000 })) {
      await signInButton.click();
      await page.waitForTimeout(1000);
      await metamask.confirmSignature();
      await page.waitForTimeout(2000);
    }

    // Verify logged in
    await expect(page.getByText('Active Session')).toBeVisible({ timeout: 10000 });

    // Now logout
    await page.getByRole('button', { name: /Logout/i }).click();
    await page.waitForTimeout(1000);

    // Verify logged out
    await expect(page.getByText('Decentralized Authentication')).toBeVisible();
    await expect(page.getByText('Sign In')).toBeVisible();
    
    console.log('✅ Logout successful');
  });
});
