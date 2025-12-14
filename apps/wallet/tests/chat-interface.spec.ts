/**
 * Chat Interface E2E Tests
 * Tests the agentic chat interface with decentralized inference
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup, { PASSWORD } from './wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Chat Interface - Not Connected', () => {
  test('should show connect prompt when wallet not connected', async ({ page }) => {
    await page.goto('/');
    
    // Chat input should be disabled
    const chatInput = page.locator('textarea');
    await expect(chatInput).toBeDisabled();
    
    // Should show connect wallet message
    await expect(page.locator('text=/Connect.*wallet/i')).toBeVisible();
  });

  test('should show placeholder text when not connected', async ({ page }) => {
    await page.goto('/');
    const chatInput = page.locator('textarea');
    await expect(chatInput).toHaveAttribute('placeholder', /Connect wallet/i);
  });
  
  test('should show inference status indicator', async ({ page }) => {
    await page.goto('/');
    // Should show inference status (Decentralized AI, Connecting, or Offline)
    const statusIndicator = page.locator('text=/Decentralized AI|Connecting|Offline|Local/i');
    await expect(statusIndicator.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Chat Interface - Connected', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    await page.goto('/');
    
    const connectButton = page.locator('button:has-text("MetaMask"), button:has-text("Injected")').first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
      await page.waitForTimeout(1000);
    }
  });

  test('should show welcome message when chat is empty', async ({ page }) => {
    await expect(page.locator('text=/How can I help|Welcome to Jeju/i')).toBeVisible();
  });

  test('should show quick action buttons', async ({ page }) => {
    await expect(page.locator('button:has-text("Portfolio")')).toBeVisible();
    await expect(page.locator('button:has-text("Swap")')).toBeVisible();
    await expect(page.locator('button:has-text("Help")')).toBeVisible();
  });

  test('should populate input when clicking quick action', async ({ page }) => {
    const portfolioButton = page.locator('button:has-text("Portfolio")');
    await portfolioButton.click();
    
    const chatInput = page.locator('textarea');
    await expect(chatInput).toHaveValue(/portfolio|balance/i);
  });

  test('should have enabled chat input', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await expect(chatInput).toBeEnabled();
    await expect(chatInput).toHaveAttribute('placeholder', /Ask me anything/i);
  });

  test('should allow typing in chat input', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await chatInput.fill('Show my balance');
    await expect(chatInput).toHaveValue('Show my balance');
  });

  test('should send message on Enter key', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await chatInput.fill('Hello');
    await page.keyboard.press('Enter');
    
    // Message should appear in chat
    await page.waitForTimeout(500);
    const sentMessage = page.locator('text="Hello"');
    await expect(sentMessage.first()).toBeVisible();
  });

  test('should show agent response after sending message', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await chatInput.fill('help');
    await page.keyboard.press('Enter');
    
    // Should get a response (local fallback or decentralized)
    await page.waitForTimeout(2000);
    const response = page.locator('text=/Portfolio|Swap|Send|Trading/i');
    await expect(response.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show connection status indicator', async ({ page }) => {
    // Should show inference status
    const statusIndicator = page.locator('text=/Decentralized AI|Offline|Local/i');
    await expect(statusIndicator.first()).toBeVisible();
  });

  test('should show message timestamps', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await chatInput.fill('test message');
    await page.keyboard.press('Enter');
    
    await page.waitForTimeout(500);
    
    // Should show timestamp
    const timestamp = page.locator('text=/\\d{1,2}:\\d{2}/');
    await expect(timestamp.first()).toBeVisible();
  });
  
  test('should show clear button when messages exist', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await chatInput.fill('test');
    await page.keyboard.press('Enter');
    
    await page.waitForTimeout(500);
    
    // Clear button should appear
    const clearButton = page.locator('button:has-text("Clear")');
    await expect(clearButton).toBeVisible();
  });
});

test.describe('Chat - Portfolio Commands', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    await page.goto('/');
    
    const connectButton = page.locator('button:has-text("MetaMask"), button:has-text("Injected")').first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
      await page.waitForTimeout(1000);
    }
  });

  test('should respond to balance command', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await chatInput.fill('balance');
    await page.keyboard.press('Enter');
    
    await page.waitForTimeout(1000);
    const response = page.locator('text=/Portfolio|Balance|ETH/i');
    await expect(response.first()).toBeVisible();
  });

  test('should respond to portfolio command', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await chatInput.fill('show my portfolio');
    await page.keyboard.press('Enter');
    
    await page.waitForTimeout(1000);
    const response = page.locator('text=/Portfolio|Balance/i');
    await expect(response.first()).toBeVisible();
  });

  test('should respond to help command', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await chatInput.fill('help');
    await page.keyboard.press('Enter');
    
    await page.waitForTimeout(1000);
    const response = page.locator('text=/I can help|Portfolio|Swap|Send|Bridge/i');
    await expect(response.first()).toBeVisible();
  });
});

test.describe('Chat - Send Button', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, PASSWORD, extensionId);
    await page.goto('/');
    
    const connectButton = page.locator('button:has-text("MetaMask"), button:has-text("Injected")').first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await metamask.connectToDapp();
      await page.waitForTimeout(1000);
    }
  });

  test('should have disabled send button when input is empty', async ({ page }) => {
    const sendButton = page.locator('button').filter({ has: page.locator('svg.lucide-send') });
    await expect(sendButton).toBeDisabled();
  });

  test('should enable send button when input has text', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await chatInput.fill('test');
    
    const sendButton = page.locator('button').filter({ has: page.locator('svg.lucide-send') });
    await expect(sendButton).toBeEnabled();
  });

  test('should send message when clicking send button', async ({ page }) => {
    const chatInput = page.locator('textarea');
    await chatInput.fill('test message');
    
    const sendButton = page.locator('button').filter({ has: page.locator('svg.lucide-send') });
    await sendButton.click();
    
    await page.waitForTimeout(500);
    const sentMessage = page.locator('text="test message"');
    await expect(sentMessage.first()).toBeVisible();
  });
});
