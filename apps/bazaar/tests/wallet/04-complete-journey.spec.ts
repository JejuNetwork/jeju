import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../../test/wallet-setup/jeju.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Complete User Journey with Synpress', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)
    
    await page.goto('/')
    
    const connectButton = page.getByRole('button', { name: /Connect Wallet/i })
    if (await connectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await connectButton.click()
      await page.waitForTimeout(1000)
      await metamask.connectToDapp()
      await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 10000 })
    }
  })

  test('should navigate through all major pages', async ({ page }) => {
    const pages = [
      { path: '/tokens', heading: /Tokens/i },
      { path: '/swap', heading: /Swap/i },
      { path: '/pools', heading: /Pools/i },
      { path: '/liquidity', heading: /Add Liquidity/i },
      { path: '/nfts', heading: /NFT Marketplace/i },
      { path: '/my-nfts', heading: /My NFTs/i },
      { path: '/games', heading: /Onchain Games/i },
    ];

    for (const { path, heading } of pages) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 5000 });
    }
  });

  test('should interact with all navigation links', async ({ page }) => {
    await page.goto('/');

    const navLinks = ['Tokens', 'Swap', 'Pools', 'NFTs'];
    
    for (const linkText of navLinks) {
      const link = page.getByRole('link', { name: new RegExp(`^${linkText}$`, 'i') });
      await expect(link).toBeVisible();
      
      await link.click();
      await page.waitForTimeout(500);
      
      await expect(page).toHaveURL(new RegExp(`/${linkText.toLowerCase()}`));
      
      // Return home
      await page.goto('/');
      await page.waitForTimeout(300);
    }
  });

  test('should show wallet address in header', async ({ page }) => {
    await page.goto('/');
    
    // Address should be visible in header
    await expect(page.getByText(/0xf39F...92266/i)).toBeVisible();
  });

  test('should access all wallet-required features', async ({ page }) => {
    // Token creation
    await page.goto('/tokens/create');
    await expect(page.getByRole('heading', { name: /Create Token/i })).toBeVisible();
    await expect(page.getByText(/Please connect your wallet/i)).not.toBeVisible();

    // My NFTs
    await page.goto('/my-nfts');
    await expect(page.getByRole('heading', { name: /My NFTs/i })).toBeVisible();
    await expect(page.getByText(/Connect your wallet to view/i)).not.toBeVisible();

    // Swap
    await page.goto('/swap');
    const swapButton = page.getByRole('button', { name: /Swap|Switch to Jeju/i }).first();
    await expect(swapButton).toBeVisible();
    const buttonText = await swapButton.textContent();
    expect(buttonText).not.toContain('Connect Wallet');
  });
});

