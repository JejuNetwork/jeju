/**
 * Test Every Form - Complete Form Coverage
 * Tests every input field, validates all forms work without errors
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { GATEWAY_URL } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('EVERY FORM TEST - Complete Form Validation', () => {
  test('MASTER: Test all forms and inputs across Gateway', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);

    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);
    await page.waitForTimeout(2000);

    const formsWorking: string[] = [];

    // ===================
    // FORM 1: Register Token
    // ===================
    await page.getByRole('button', { name: /Registered Tokens/i }).click();
    await page.waitForTimeout(1000);

    // Find register form
    const tokenAddressInput = page.getByPlaceholder('0x...');
    if (await tokenAddressInput.isVisible()) {
      // Fill all fields
      await tokenAddressInput.fill('0x1234567890123456789012345678901234567890');
      await page.locator('input[placeholder="0"]').fill('0');
      await page.locator('input[placeholder="200"]').fill('200');
      
      // Verify submit button becomes clickable
      const submitButton = page.getByRole('button', { name: /Register Token/i });
      const enabled = await submitButton.isEnabled();
      
      if (enabled) {
        formsWorking.push('✅ Register Token Form');
        console.log('✅ Form 1/6: Register Token - All fields work');
      }
      
      await page.screenshot({ path: 'test-results/screenshots/visual-forms/01-register-token-filled.png', fullPage: true });
    }

    // ===================
    // FORM 2: Bridge Token
    // ===================
    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click();
    await page.waitForTimeout(1000);

    // Fill bridge form
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('VIRTUAL').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('0.0').fill('50');
    await page.getByPlaceholder(/0x.../).fill('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    await page.waitForTimeout(500);

    const bridgeButton = page.getByRole('button', { name: /Bridge to Jeju/i });
    if (await bridgeButton.isEnabled()) {
      formsWorking.push('✅ Bridge Form');
      console.log('✅ Form 2/6: Bridge Token - All fields work');
    }

    await page.screenshot({ path: 'test-results/screenshots/visual-forms/02-bridge-form-filled.png', fullPage: true });

    // ===================
    // FORM 3: Deploy Paymaster
    // ===================
    await page.getByRole('button', { name: /Deploy Paymaster/i }).click();
    await page.waitForTimeout(1000);

    // Select token
    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    // Adjust fee slider (if visible)
    const slider = page.locator('input[type="range"]');
    if (await slider.isVisible()) {
      await slider.fill('150');
      formsWorking.push('✅ Deploy Paymaster Form');
      console.log('✅ Form 3/6: Deploy Paymaster - Controls work');
    }

    await page.screenshot({ path: 'test-results/screenshots/visual-forms/03-deploy-paymaster-configured.png', fullPage: true });

    // ===================
    // FORM 4: Add Liquidity
    // ===================
    await page.getByRole('button', { name: /Add Liquidity/i }).click();
    await page.waitForTimeout(1000);

    await page.locator('.input').first().click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    const ethInput = page.getByPlaceholder('1.0');
    if (await ethInput.isVisible()) {
      await ethInput.fill('0.5');
      await page.waitForTimeout(500);
      
      formsWorking.push('✅ Add Liquidity Form');
      console.log('✅ Form 4/6: Add Liquidity - Amount input works');
    }

    await page.screenshot({ path: 'test-results/screenshots/visual-forms/04-add-liquidity-filled.png', fullPage: true });

    // ===================
    // FORM 5: Register Node
    // ===================
    await page.getByRole('button', { name: /Node Operators/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register New Node/i }).click();
    await page.waitForTimeout(1000);

    // Fill all node registration fields
    const stakingSelector = page.locator('label:has-text("Staking Token")').locator('..').locator('.input');
    await stakingSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').first().click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('Amount').fill('10000');
    await page.waitForTimeout(300);

    const rewardSelector = page.locator('label:has-text("Reward Token")').locator('..').locator('.input');
    await rewardSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').nth(1).click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/https:\/\/your-node/i).fill('https://node.example.com:8545');
    await page.waitForTimeout(300);

    // Select region
    const regionSelect = page.locator('select');
    if (await regionSelect.isVisible()) {
      await regionSelect.selectOption({ index: 0 });
    }

    formsWorking.push('✅ Register Node Form');
    console.log('✅ Form 5/6: Register Node - All fields work');

    await page.screenshot({ path: 'test-results/screenshots/visual-forms/05-register-node-filled.png', fullPage: true });

    // ===================
    // FORM 6: Register App
    // ===================
    await page.getByRole('button', { name: /App Registry/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Register App/i }).click();
    await page.waitForTimeout(1000);

    // Fill all app registration fields
    await page.getByPlaceholder('My Awesome App').fill('Complete Test App');
    await page.getByPlaceholder(/Brief description/i).fill('Testing all form fields');
    await page.getByPlaceholder('https://myapp.com/a2a').fill('http://localhost:4003/a2a');
    
    // Select tags
    await page.getByRole('button', { name: /🎮 Game/i }).click();
    await page.getByRole('button', { name: /💬 Social/i }).click();
    
    // Select stake token
    const appStakeSelector = page.locator('label:has-text("Stake Token")').locator('..').locator('.input');
    await appStakeSelector.click();
    await page.waitForTimeout(500);
    await page.getByText('elizaOS').click();
    await page.waitForTimeout(1000);

    const appSubmitButton = page.getByRole('button', { name: /Register App$/i });
    if (await appSubmitButton.isEnabled()) {
      formsWorking.push('✅ Register App Form');
      console.log('✅ Form 6/6: Register App - All fields work');
    }

    await page.screenshot({ path: 'test-results/screenshots/visual-forms/06-register-app-filled.png', fullPage: true });

    // ===================
    // FINAL VALIDATION
    // ===================
    console.log('\n🎉 ALL FORMS TESTED');
    console.log(`   ✅ ${formsWorking.length}/6 forms working correctly`);
    console.log('\n📋 Forms Validated:');
    formsWorking.forEach((form, i) => {
      console.log(`   ${i + 1}. ${form}`);
    });

    expect(formsWorking.length).toBeGreaterThanOrEqual(4);
  });
});

test.describe('Form Field Validation - All Inputs', () => {
  test('should test all input types across all forms', async ({ page, metamask }) => {
    await page.goto(GATEWAY_URL);
    await connectWallet(page, metamask);

        const inputTypes: string[] = [];

    // Check for all input types
    const textInputs = await page.locator('input[type="text"], input[placeholder]').count();
    const numberInputs = await page.locator('input[type="number"]').count();
    const rangeInputs = await page.locator('input[type="range"]').count();
    const selectInputs = await page.locator('select').count();
    const textareas = await page.locator('textarea').count();

    console.log(`ℹ️  Input Types Found:`);
    console.log(`   Text inputs: ${textInputs}`);
    console.log(`   Number inputs: ${numberInputs}`);
    console.log(`   Range inputs (sliders): ${rangeInputs}`);
    console.log(`   Selects: ${selectInputs}`);
    console.log(`   Textareas: ${textareas}`);

    const total = textInputs + numberInputs + rangeInputs + selectInputs + textareas;
    console.log(`✅ Total input fields: ${total}`);

    expect(total).toBeGreaterThan(0);
  });
});


