import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Factory App - Distributed Training', () => {
  test('should load training page', async ({ page }) => {
    await page.goto('/training');
    
    await expect(page.locator('h1:has-text("Distributed Training")')).toBeVisible();
    await expect(page.locator('text=Psyche-powered')).toBeVisible();
  });

  test('should show training stats cards', async ({ page }) => {
    await page.goto('/training');
    
    await expect(page.locator('text=Active Runs')).toBeVisible();
    await expect(page.locator('text=Available Nodes')).toBeVisible();
    await expect(page.locator('text=Trainable Models')).toBeVisible();
    await expect(page.locator('text=Total Rewards')).toBeVisible();
  });

  test('should switch between tabs', async ({ page }) => {
    await page.goto('/training');
    
    // Default is runs tab
    await expect(page.locator('button:has-text("Training Runs")')).toHaveClass(/bg-accent/);
    
    // Switch to models
    await page.click('button:has-text("Base Models")');
    await expect(page.locator('button:has-text("Base Models")')).toHaveClass(/bg-accent/);
    
    // Switch to nodes
    await page.click('button:has-text("Compute Nodes")');
    await expect(page.locator('button:has-text("Compute Nodes")')).toHaveClass(/bg-accent/);
  });

  test('should show base models in models tab', async ({ page }) => {
    await page.goto('/training');
    
    await page.click('button:has-text("Base Models")');
    
    await expect(page.locator('text=LLaMA 3 8B')).toBeVisible();
    await expect(page.locator('text=Mistral 7B')).toBeVisible();
  });

  test('should navigate to create training page', async ({ page }) => {
    await page.goto('/training');
    
    await page.click('a:has-text("New Training Run")');
    
    await expect(page).toHaveURL('/training/create');
    await expect(page.locator('h1:has-text("Create Training Run")')).toBeVisible();
  });

  test('should show training run creation wizard', async ({ page }) => {
    await page.goto('/training/create');
    
    // Check all wizard steps are visible
    await expect(page.locator('text=Select Model')).toBeVisible();
    await expect(page.locator('text=Dataset')).toBeVisible();
    await expect(page.locator('text=Configuration')).toBeVisible();
    await expect(page.locator('text=Compute Nodes')).toBeVisible();
    await expect(page.locator('text=Review & Launch')).toBeVisible();
  });

  test('should select base model', async ({ page }) => {
    await page.goto('/training/create');
    
    // Search for model
    await page.fill('input[placeholder="Search models..."]', 'mistral');
    
    // Select Mistral
    await page.click('button:has-text("Mistral 7B")');
    
    // Model should be selected
    await expect(page.locator('button:has-text("Mistral 7B") svg.text-accent-400')).toBeVisible();
  });

  test('should navigate through wizard steps', async ({ page }) => {
    await page.goto('/training/create');
    
    // Step 1: Select model
    await page.click('button:has-text("LLaMA 3 8B")');
    await page.click('button:has-text("Continue")');
    
    // Step 2: Select dataset
    await expect(page.locator('text=Select Training Dataset')).toBeVisible();
    await page.click('button:has-text("Jeju Documentation")');
    await page.click('button:has-text("Continue")');
    
    // Step 3: Configuration
    await expect(page.locator('text=Training Configuration')).toBeVisible();
    await page.click('button:has-text("Continue")');
    
    // Step 4: Nodes
    await expect(page.locator('text=Select Compute Nodes')).toBeVisible();
    await page.click('button:has-text("Continue")');
    
    // Step 5: Review
    await expect(page.locator('text=Review & Launch')).toBeVisible();
    await expect(page.locator('button:has-text("Launch Training")')).toBeVisible();
  });

  test('should update training configuration', async ({ page }) => {
    await page.goto('/training/create');
    
    // Go to config step
    await page.click('button:has-text("LLaMA 3 8B")');
    await page.click('button:has-text("Continue")');
    await page.click('button:has-text("Jeju Documentation")');
    await page.click('button:has-text("Continue")');
    
    // Update total steps
    const stepsInput = page.locator('input[type="number"]').first();
    await stepsInput.fill('2000');
    expect(await stepsInput.inputValue()).toBe('2000');
    
    // Update batch size
    const batchInput = page.locator('input[type="number"]').nth(1);
    await batchInput.fill('512');
    expect(await batchInput.inputValue()).toBe('512');
    
    // Toggle privacy mode
    await page.click('button:has-text("Private")');
    await expect(page.locator('button:has-text("Private") svg.text-accent-400')).toBeVisible();
  });

  test('should show stake amount in review', async ({ page }) => {
    await page.goto('/training/create');
    
    // Complete wizard
    await page.click('button:has-text("LLaMA 3 8B")');
    await page.click('button:has-text("Continue")');
    await page.click('button:has-text("Jeju Documentation")');
    await page.click('button:has-text("Continue")');
    await page.click('button:has-text("Continue")');
    await page.click('button:has-text("Continue")');
    
    // Check stake input exists
    await expect(page.locator('input[value="0.01"]')).toBeVisible();
    await expect(page.locator('text=Stake Amount')).toBeVisible();
  });

  test('should start training with wallet connected', async ({ 
    page, 
    context, 
    metamaskPage, 
    extensionId 
  }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto('/training/create');
    
    // Connect wallet first
    await page.click('button:has-text("Connect Wallet")');
    await metamask.connectToDapp();
    
    // Complete wizard
    await page.click('button:has-text("LLaMA 3 8B")');
    await page.click('button:has-text("Continue")');
    await page.click('button:has-text("Jeju Documentation")');
    await page.click('button:has-text("Continue")');
    await page.click('button:has-text("Continue")');
    await page.click('button:has-text("Continue")');
    
    // Launch training
    await page.click('button:has-text("Launch Training")');
    
    // Should prompt MetaMask to confirm transaction
    await metamask.confirmTransaction();
    
    // Should redirect to training page on success
    await expect(page).toHaveURL('/training', { timeout: 30000 });
  });

  test('should show node performance metrics', async ({ page }) => {
    await page.goto('/training');
    
    await page.click('button:has-text("Compute Nodes")');
    
    // Check columns exist
    await expect(page.locator('text=GPU Tier')).toBeVisible();
    await expect(page.locator('text=Score')).toBeVisible();
    await expect(page.locator('text=Latency')).toBeVisible();
    await expect(page.locator('text=Bandwidth')).toBeVisible();
    await expect(page.locator('text=Status')).toBeVisible();
  });

  test('should show fine-tune button on models', async ({ page }) => {
    await page.goto('/training');
    
    await page.click('button:has-text("Base Models")');
    
    const finetuneButtons = page.locator('a:has-text("Fine-tune")');
    expect(await finetuneButtons.count()).toBeGreaterThan(0);
  });

  test('should pre-fill model from URL param', async ({ page }) => {
    await page.goto('/training/create?model=meta/llama-3-8b');
    
    // LLaMA should be pre-selected
    await expect(page.locator('button:has-text("LLaMA 3 8B") svg')).toBeVisible();
  });

  test('should go back in wizard', async ({ page }) => {
    await page.goto('/training/create');
    
    // Go to step 2
    await page.click('button:has-text("LLaMA 3 8B")');
    await page.click('button:has-text("Continue")');
    
    await expect(page.locator('text=Select Training Dataset')).toBeVisible();
    
    // Go back
    await page.click('button:has-text("Back")');
    
    await expect(page.locator('text=Select Base Model')).toBeVisible();
  });

  test('should disable continue button without selection', async ({ page }) => {
    await page.goto('/training/create');
    
    // Continue should be disabled without model selection
    const continueButton = page.locator('button:has-text("Continue")');
    await expect(continueButton).toBeDisabled();
    
    // Select model
    await page.click('button:has-text("LLaMA 3 8B")');
    
    // Continue should now be enabled
    await expect(continueButton).toBeEnabled();
  });

  test('should show training run progress', async ({ page }) => {
    await page.goto('/training');
    
    // If there are active runs, check progress bar exists
    const progressBars = page.locator('.bg-gradient-to-r.from-green-500');
    const count = await progressBars.count();
    
    if (count > 0) {
      await expect(progressBars.first()).toBeVisible();
    }
  });

  test('should refresh training data', async ({ page }) => {
    await page.goto('/training');
    
    // Click refresh button
    await page.click('button:has-text("Refresh")');
    
    // Should show loading state briefly then data
    await expect(page.locator('text=Active Runs')).toBeVisible({ timeout: 5000 });
  });
});

