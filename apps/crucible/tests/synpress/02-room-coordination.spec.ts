/**
 * Room Coordination Tests
 * Tests room creation, joining, and multi-agent coordination
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../synpress.config';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Room Coordination', () => {
  test.beforeEach(async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Connect wallet
    await page.getByTestId('connect-wallet').click();
    await metamask.connectToDapp();
    await expect(page.getByTestId('wallet-info')).toBeVisible({ timeout: 10000 });
  });

  test('should show room types in create dialog', async ({ page }) => {
    await page.getByTestId('create-room-btn').click();
    
    const roomTypeSelect = page.getByTestId('room-type-select');
    await expect(roomTypeSelect).toBeVisible();
    
    // Check room type options
    const options = page.getByTestId('room-type-option');
    await expect(options).toHaveCount(4); // collaboration, adversarial, debate, council
  });

  test('should create adversarial room', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    await page.getByTestId('create-room-btn').click();
    
    // Fill room details
    await page.getByTestId('room-name-input').fill('Security Challenge');
    await page.getByTestId('room-description-input').fill('Red vs Blue security testing');
    await page.getByTestId('room-type-select').selectOption('adversarial');
    
    // Submit
    await page.getByTestId('submit-room-btn').click();
    
    // Should trigger transaction
    await metamask.confirmTransaction();
    
    // Verify room created
    const roomCard = page.getByTestId('room-card').first();
    await expect(roomCard).toBeVisible({ timeout: 15000 });
  });

  test('should join room as red team', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId);
    
    // Navigate to existing room
    const roomCard = page.getByTestId('room-card').first();
    await roomCard.click();
    
    // Join as red team
    await page.getByTestId('join-room-btn').click();
    await page.getByTestId('role-select').selectOption('red_team');
    await page.getByTestId('confirm-join-btn').click();
    
    // Confirm transaction
    await metamask.confirmTransaction();
    
    // Verify joined
    const memberBadge = page.getByTestId('member-badge');
    await expect(memberBadge).toBeVisible({ timeout: 15000 });
    await expect(memberBadge).toContainText('Red Team');
  });

  test('should display room messages', async ({ page }) => {
    // Navigate to room with messages
    const roomCard = page.getByTestId('room-card').first();
    await roomCard.click();
    
    const messageList = page.getByTestId('message-list');
    await expect(messageList).toBeVisible();
  });

  test('should show room scores for adversarial rooms', async ({ page }) => {
    // Navigate to adversarial room
    await page.getByTestId('room-filter-adversarial').click();
    const roomCard = page.getByTestId('room-card').first();
    await roomCard.click();
    
    const scoreBoard = page.getByTestId('score-board');
    await expect(scoreBoard).toBeVisible();
    
    // Verify red and blue team scores shown
    await expect(page.getByTestId('red-team-score')).toBeVisible();
    await expect(page.getByTestId('blue-team-score')).toBeVisible();
  });
});
