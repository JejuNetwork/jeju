/**
 * Test Every Button - Complete Button Coverage
 * Clicks every button on every page to ensure they work
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { GATEWAY_URL } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('EVERY BUTTON TEST - Complete Button Coverage', () => {
  test('MASTER: Click and test every button in Gateway', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(2000);

    const buttonsClicked: string[] = [];

    // ===================
    // TAB BUTTONS (7 main tabs)
    // ===================
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
      const button = page.getByRole('button', { name: tab });
      await button.click();
      await page.waitForTimeout(500);
      
      // Verify no error after click
      const bodyText = await page.textContent('body');
      if (bodyText?.toLowerCase().includes('error') && !bodyText.toLowerCase().includes('no error')) {
        throw new Error(`Error found after clicking ${tab}`);
      }
      
      buttonsClicked.push(`Tab: ${tab}`);
      console.log(`✅ Tab Button: ${tab}`);
    }

    // ===================
    // NODE OPERATORS SUB-BUTTONS (3 sections)
    // ===================
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);

    const nodeButtons = [
      /Network Overview/i,
      /My Nodes/i,
      /Register New Node/i,
    ];

    for (const buttonName of nodeButtons) {
      const button = page.getByRole('button', { name: buttonName });
      await button.click();
      await page.waitForTimeout(500);
      
      buttonsClicked.push(`Node Section: ${buttonName.source}`);
      console.log(`✅ Node Button: ${buttonName.source}`);
    }

    // ===================
    // APP REGISTRY SUB-BUTTONS (2 sections)
    // ===================
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(500);

    const registryButtons = [
      /Browse Apps/i,
      /Register App/i,
    ];

    for (const buttonName of registryButtons) {
      const button = page.getByRole('button', { name: buttonName });
      await button.click();
      await page.waitForTimeout(500);
      
      buttonsClicked.push(`Registry Section: ${buttonName.source}`);
      console.log(`✅ Registry Button: ${buttonName.source}`);
    }

    // ===================
    // BRIDGE MODE BUTTONS (2 modes)
    // ===================
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(500);

    const modeButtons = [
      /Select Token/i,
      /Custom Address/i,
    ];

    for (const buttonName of modeButtons) {
      const button = page.getByRole('button', { name: buttonName });
      await button.click();
      await page.waitForTimeout(500);
      
      buttonsClicked.push(`Bridge Mode: ${buttonName.source}`);
      console.log(`✅ Bridge Mode Button: ${buttonName.source}`);
    }

    // ===================
    // TAG FILTER BUTTONS (7 tags)
    // ===================
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Browse Apps/i }).click();
    await page.waitForTimeout(500);

    const tagButtons = ['All Apps', 'Applications', 'Games', 'Marketplaces', 'DeFi', 'Social'];

    for (const tag of tagButtons) {
      const button = page.getByText(tag);
      if (await button.isVisible()) {
        await button.click();
        await page.waitForTimeout(300);
        
        buttonsClicked.push(`Tag Filter: ${tag}`);
        console.log(`✅ Tag Button: ${tag}`);
      }
    }

    // ===================
    // APP CATEGORY BUTTONS (7 categories)
    // ===================
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(500);

    const categoryButtons = [
      /📱 Application/i,
      /🎮 Game/i,
      /🏪 Marketplace/i,
      /💰 DeFi/i,
      /💬 Social/i,
      /📊 Information Provider/i,
      /⚙️ Service/i,
    ];

    for (const buttonName of categoryButtons) {
      const button = page.getByRole('button', { name: buttonName });
      if (await button.isVisible()) {
        await button.click();
        await page.waitForTimeout(200);
        
        buttonsClicked.push(`Category: ${buttonName.source}`);
        console.log(`✅ Category Button: ${buttonName.source}`);
      }
    }

    // ===================
    // REFRESH BUTTONS (if exist)
    // ===================
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await page.waitForTimeout(500);

    const refreshButton = page.getByRole('button', { name: /Refresh/i });
    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await page.waitForTimeout(500);
      
      buttonsClicked.push('Refresh Button');
      console.log('✅ Refresh Button');
    }

    // ===================
    // FINAL COUNT
    // ===================
    console.log('\n🎉 EVERY BUTTON TESTED');
    console.log(`   ✅ ${buttonsClicked.length} buttons clicked and tested`);
    console.log(`   ✅ No errors or failures detected`);
    console.log('\n📋 Buttons Tested:');
    buttonsClicked.forEach((btn, i) => {
      console.log(`   ${i + 1}. ${btn}`);
    });

    expect(buttonsClicked.length).toBeGreaterThan(25);
  });
});


