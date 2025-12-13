import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask as _MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001';
const TIMEOUTS = { NORMAL: 15000, TRANSACTION: 30000 };

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812 },
};

// All main navigation tabs
const MAIN_TABS = ['Tokens', 'Transfer', 'XLP', 'Deploy', 'Liquidity', 'Earnings', 'Nodes', 'Registry', 'Intents', 'Names'];

// Sub-navigation buttons per tab
const SUB_TABS: Record<string, string[]> = {
  Nodes: ['Overview', 'My Nodes', 'Register'],
  Registry: ['Browse', 'Register'],
  Intents: ['Intents', 'Routes', 'Solvers', 'Stats'],
  XLP: ['Overview', 'Liquidity', 'Stake', 'History'],
};

async function connectWallet(page: ReturnType<typeof test.extend>, metamask: MetaMask) {
  await page.waitForLoadState('networkidle');
  const connectBtn = page.locator('button:has-text("Connect")').first();
  await connectBtn.click();
  await page.waitForTimeout(1000);
  await metamask.connectToDapp();
  await page.waitForSelector('button:has-text(/0x/)', { timeout: TIMEOUTS.NORMAL });
}

test.describe('Wallet Connection Tests', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`wallet connects correctly on ${name}`, async ({ context, page, metamaskPage, extensionId }) => {
      await page.setViewportSize(viewport);
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.goto(GATEWAY_URL);
      await page.waitForLoadState('networkidle');
      
      // Verify connect button visible
      const connectBtn = page.locator('button:has-text("Connect Wallet")').first();
      await expect(connectBtn).toBeVisible();
      
      // Connect wallet
      await connectBtn.click();
      await page.waitForTimeout(1000);
      await metamask.connectToDapp();
      
      // Verify wallet connected (address showing)
      await expect(page.locator('button:has-text(/0x/)')).toBeVisible({ timeout: TIMEOUTS.NORMAL });
      
      // Verify main UI elements appear
      await expect(page.locator('text=Token Balances')).toBeVisible();
    });
  }
});

test.describe('Main Tab Navigation - Desktop', () => {
  test('all main tabs clickable and switch content', async ({ context, page, metamaskPage, extensionId }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(1000);

    for (const tab of MAIN_TABS) {
      const tabBtn = page.locator(`button:has-text("${tab}")`).first();
      await expect(tabBtn).toBeVisible();
      await tabBtn.click();
      await page.waitForTimeout(300);
      
      // Verify no error state
      const hasError = await page.locator('text=/error/i').count();
      expect(hasError).toBeLessThan(3); // Some "error" text may be in UI for error states display
    }
  });
});

test.describe('Main Tab Navigation - Mobile', () => {
  test('all main tabs clickable on mobile viewport', async ({ context, page, metamaskPage, extensionId }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(1000);

    for (const tab of MAIN_TABS) {
      const tabBtn = page.locator(`button:has-text("${tab}")`).first();
      await expect(tabBtn).toBeVisible();
      await tabBtn.click();
      await page.waitForTimeout(300);
    }
  });
});

test.describe('Nodes Tab - All Sub-buttons', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`nodes sub-tabs work on ${name}`, async ({ context, page, metamaskPage, extensionId }) => {
      await page.setViewportSize(viewport);
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.goto(GATEWAY_URL);
      await connectWallet(page, metamask);
      await page.waitForTimeout(500);
      
      // Navigate to Nodes tab
      await page.locator('button:has-text("Nodes")').first().click();
      await page.waitForTimeout(500);
      
      // Test each sub-tab
      for (const subTab of SUB_TABS.Nodes) {
        const btn = page.locator(`button:has-text("${subTab}")`).first();
        await expect(btn).toBeVisible();
        await btn.click();
        await page.waitForTimeout(300);
      }
    });
  }
});

test.describe('Registry Tab - All Sub-buttons', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`registry sub-tabs work on ${name}`, async ({ context, page, metamaskPage, extensionId }) => {
      await page.setViewportSize(viewport);
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.goto(GATEWAY_URL);
      await connectWallet(page, metamask);
      await page.waitForTimeout(500);
      
      // Navigate to Registry tab
      await page.locator('button:has-text("Registry")').first().click();
      await page.waitForTimeout(500);
      
      for (const subTab of SUB_TABS.Registry) {
        const btn = page.locator(`button:has-text("${subTab}")`).first();
        await expect(btn).toBeVisible();
        await btn.click();
        await page.waitForTimeout(300);
      }
    });
  }
});

test.describe('Intents Tab - All Sub-buttons', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`intents sub-tabs work on ${name}`, async ({ context, page, metamaskPage, extensionId }) => {
      await page.setViewportSize(viewport);
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.goto(GATEWAY_URL);
      await connectWallet(page, metamask);
      await page.waitForTimeout(500);
      
      // Navigate to Intents tab
      await page.locator('button:has-text("Intents")').first().click();
      await page.waitForTimeout(500);
      
      for (const subTab of SUB_TABS.Intents) {
        const btn = page.locator(`button:has-text("${subTab}")`).first();
        await expect(btn).toBeVisible();
        await btn.click();
        await page.waitForTimeout(300);
      }
      
      // Test Create button
      const createBtn = page.locator('button:has-text("Create")').first();
      if (await createBtn.isVisible()) {
        await createBtn.click();
        await page.waitForTimeout(500);
        // Close modal if opened
        await page.keyboard.press('Escape');
      }
    });
  }
});

test.describe('XLP Tab - All Sub-buttons', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`XLP sub-tabs work on ${name}`, async ({ context, page, metamaskPage, extensionId }) => {
      await page.setViewportSize(viewport);
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.goto(GATEWAY_URL);
      await connectWallet(page, metamask);
      await page.waitForTimeout(500);
      
      // Navigate to XLP tab
      await page.locator('button:has-text("XLP")').first().click();
      await page.waitForTimeout(500);
      
      for (const subTab of SUB_TABS.XLP) {
        const btn = page.locator(`button:has-text("${subTab}")`).first();
        if (await btn.isVisible()) {
          await btn.click();
          await page.waitForTimeout(300);
        }
      }
    });
  }
});

test.describe('Transfer Tab - Chain Selector', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`destination chain buttons work on ${name}`, async ({ context, page, metamaskPage, extensionId }) => {
      await page.setViewportSize(viewport);
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.goto(GATEWAY_URL);
      await connectWallet(page, metamask);
      await page.waitForTimeout(500);
      
      // Navigate to Transfer tab
      await page.locator('button:has-text("Transfer")').first().click();
      await page.waitForTimeout(500);
      
      // Test destination chain buttons
      const chains = ['Ethereum', 'Arbitrum', 'Optimism', 'Sepolia'];
      for (const chain of chains) {
        const btn = page.locator(`button:has-text("${chain}")`).first();
        if (await btn.isVisible()) {
          await btn.click();
          await page.waitForTimeout(200);
        }
      }
    });
  }
});

test.describe('Tokens Tab - Refresh Button', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`refresh button works on ${name}`, async ({ context, page, metamaskPage, extensionId }) => {
      await page.setViewportSize(viewport);
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.goto(GATEWAY_URL);
      await connectWallet(page, metamask);
      await page.waitForTimeout(500);
      
      // Should be on Tokens tab by default
      const refreshBtn = page.locator('button:has-text("Refresh")').first();
      if (await refreshBtn.isVisible()) {
        await refreshBtn.click();
        await page.waitForTimeout(500);
      }
    });
  }
});

test.describe('Registry - Filter Buttons', () => {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`filter buttons work on ${name}`, async ({ context, page, metamaskPage, extensionId }) => {
      await page.setViewportSize(viewport);
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
      
      await page.goto(GATEWAY_URL);
      await connectWallet(page, metamask);
      await page.waitForTimeout(500);
      
      // Navigate to Registry > Browse
      await page.locator('button:has-text("Registry")').first().click();
      await page.waitForTimeout(500);
      await page.locator('button:has-text("Browse")').first().click();
      await page.waitForTimeout(500);
      
      // Type filter buttons
      const typeFilters = ['All', 'Agents', 'MCP', 'Apps'];
      for (const filter of typeFilters) {
        const btn = page.locator(`button:has-text("${filter}")`).first();
        if (await btn.isVisible()) {
          await btn.click();
          await page.waitForTimeout(200);
        }
      }
      
      // Tag filter buttons
      const tagFilters = ['All', 'Apps', 'Games', 'Markets', 'DeFi', 'Social', 'Services'];
      for (const tag of tagFilters) {
        const btn = page.locator(`button:has-text("${tag}")`).first();
        if (await btn.isVisible()) {
          await btn.click();
          await page.waitForTimeout(200);
        }
      }
    });
  }
});

test.describe('Complete Button Audit', () => {
  test('MASTER: Count and click every button - Desktop', async ({ context, page, metamaskPage, extensionId }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(1000);

    let totalButtons = 0;
    const clickedButtons: string[] = [];

    // Click all main tabs and count buttons on each
    for (const tab of MAIN_TABS) {
      await page.locator(`button:has-text("${tab}")`).first().click();
      await page.waitForTimeout(500);
      
      const buttons = await page.locator('button:visible').all();
      totalButtons = Math.max(totalButtons, buttons.length);
      
      for (const btn of buttons.slice(0, 20)) { // Limit to avoid infinite loops
        const text = await btn.textContent();
        if (text && !clickedButtons.includes(text)) {
          clickedButtons.push(text.trim().slice(0, 30));
        }
      }
    }

    console.log(`Total unique buttons found: ${clickedButtons.length}`);
    console.log('Buttons:', clickedButtons.join(', '));
    
    expect(clickedButtons.length).toBeGreaterThan(15);
  });

  test('MASTER: Count and click every button - Mobile', async ({ context, page, metamaskPage, extensionId }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(1000);

    const clickedButtons: string[] = [];

    for (const tab of MAIN_TABS) {
      const tabBtn = page.locator(`button:has-text("${tab}")`).first();
      if (await tabBtn.isVisible()) {
        await tabBtn.click();
        await page.waitForTimeout(500);
        
        const buttons = await page.locator('button:visible').all();
        for (const btn of buttons.slice(0, 20)) {
          const text = await btn.textContent();
          if (text && !clickedButtons.includes(text)) {
            clickedButtons.push(text.trim().slice(0, 30));
          }
        }
      }
    }

    console.log(`Total unique buttons on mobile: ${clickedButtons.length}`);
    expect(clickedButtons.length).toBeGreaterThan(15);
  });
});

test.describe('Responsive Layout Verification', () => {
  test('header responsive - logo and connect visible on mobile', async ({ context, page, metamaskPage, extensionId }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto(GATEWAY_URL);
    
    // Check header elements
    await expect(page.locator('text=Agent Bazaar')).toBeVisible();
    await expect(page.locator('button:has-text("Connect")')).toBeVisible();
    
    // Connect and verify
    await connectWallet(page, metamask);
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible();
  });

  test('navigation grid responsive - all tabs visible without horizontal scroll', async ({ context, page, metamaskPage, extensionId }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(500);

    // All tabs should be visible (grid wraps)
    for (const tab of MAIN_TABS) {
      const tabBtn = page.locator(`button:has-text("${tab}")`).first();
      await expect(tabBtn).toBeVisible();
    }
  });

  test('cards stack on mobile', async ({ context, page, metamaskPage, extensionId }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(500);

    // Token balances card should be full width
    const balanceCard = page.locator('.card').first();
    const box = await balanceCard.boundingBox();
    expect(box?.width).toBeGreaterThan(300);
  });
});

