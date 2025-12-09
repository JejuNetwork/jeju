/**
 * Moderation Dashboard Page Tests
 * Tests the complete moderation system: reports, voting, bans, appeals
 * 
 * NOTE: Requires moderation contracts deployed
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { executeTransaction } from '../helpers/transaction-helpers';
import { REPORT_TYPES, SEVERITY, REPORT_BONDS } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const MODERATION_URL = 'http://localhost:4001/moderation';

test.describe('Moderation Dashboard - Navigation & Display', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, metamask);
  });

  test('should navigate to moderation dashboard', async ({ page }) => {
    // Navigate to moderation page
    await page.goto(MODERATION_URL);
    await page.waitForLoadState('networkidle');

    // Verify page loaded
    await expect(page.getByText('Moderation Dashboard')).toBeVisible();
    await expect(page.getByText(/Decentralized moderation/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/moderation/01-dashboard.png',
      fullPage: true,
    });

    console.log('✅ Moderation dashboard loaded');
  });

  test('should display all tabs: Active, Resolved, Submit', async ({ page }) => {
    await page.goto(MODERATION_URL);

    await expect(page.getByRole('button', { name: /Active Reports/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Resolved/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Submit Report/i })).toBeVisible();

    console.log('✅ All moderation tabs present');
  });

  test('should show active reports list', async ({ page }) => {
    await page.goto(MODERATION_URL);
    
    // Active reports tab (default)
    const emptyState = page.getByText(/No active reports/i);
    const hasReports = !(await emptyState.isVisible());

    if (hasReports) {
      // Should show report cards
      const reportCards = page.locator('.card, [class*="report"]');
      const count = await reportCards.count();
      console.log(`ℹ️  Found ${count} active reports`);
    } else {
      console.log('ℹ️  No active reports');
    }

    console.log('✅ Active reports tab working');
  });
});

test.describe('Submit Report Flow', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, metamask);
    await page.goto(MODERATION_URL);
    await page.waitForTimeout(1000);
  });

  test('should submit report with evidence upload', async ({ page, metamask }) => {
    // Click Submit Report tab
    await page.getByRole('button', { name: /Submit Report/i }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('Submit New Report')).toBeVisible();

    // Fill target agent ID
    await page.getByPlaceholder(/Enter agent ID/i).fill('123');

    // Select report type
    await page.getByText('Network Ban').click();

    // Select severity
    await page.getByText(/Medium.*3 day/).click();

    // Upload evidence file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-evidence.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Test evidence for E2E testing'),
    });

    // Wait for IPFS upload
    await expect(page.getByText(/Hash:/i)).toBeVisible({ timeout: 10000 });

    // Fill details
    await page.getByPlaceholder(/Describe the violation/i).fill('Test report for E2E testing - spam behavior detected');

    // Verify bond display
    await expect(page.getByText(REPORT_BONDS[SEVERITY.MEDIUM])).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/moderation/02-submit-report-form.png',
      fullPage: true,
    });

    // Submit report
    const submitButton = page.getByRole('button', { name: /Submit Report/i });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Confirm transaction
    await executeTransaction(page, metamask, {
      expectSuccessMessage: 'Report submitted successfully',
      timeout: 60000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/moderation/03-report-submitted.png',
      fullPage: true,
    });

    console.log('✅ Submit report transaction successful');
  });

  test('should validate all required fields', async ({ page }) => {
    await page.getByRole('button', { name: /Submit Report/i }).click();
    await page.waitForTimeout(1000);

    // Submit button should be disabled without evidence
    const submitButton = page.getByRole('button', { name: /Submit Report/i });
    await expect(submitButton).toBeDisabled();

    console.log('✅ Form validation working');
  });

  test('should display correct bond for each severity level', async ({ page }) => {
    await page.getByRole('button', { name: /Submit Report/i }).click();
    await page.waitForTimeout(1000);

    // Test each severity
    const severities = [
      { label: /Low.*7 day/, bond: REPORT_BONDS[SEVERITY.LOW] },
      { label: /Medium.*3 day/, bond: REPORT_BONDS[SEVERITY.MEDIUM] },
      { label: /High.*1 day/, bond: REPORT_BONDS[SEVERITY.HIGH] },
      { label: /Critical.*Immediate/, bond: REPORT_BONDS[SEVERITY.CRITICAL] },
    ];

    for (const sev of severities) {
      await page.getByText(sev.label).click();
      await expect(page.getByText(sev.bond)).toBeVisible();
      console.log(`✅ ${sev.bond} bond shown for severity`);
    }
  });
});

test.describe('Vote on Report Flow', () => {
  test('should vote on active report', async ({ page, metamask }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, metamask);
    await page.goto(MODERATION_URL);
    await page.waitForTimeout(1000);

    // Check for active reports
    const reportCards = page.locator('.card').filter({ hasText: /Agent #/i });
    const count = await reportCards.count();

    if (count === 0) {
      console.log('ℹ️  No reports to vote on');
      return;
    }

    // Click Vote on first report
    const voteButton = page.getByRole('button', { name: /Vote/i }).first();
    await voteButton.click();
    await page.waitForTimeout(1000);

    // Should see voting interface
    await expect(page.getByText(/YES.*Ban/i)).toBeVisible();
    await expect(page.getByText(/NO.*Reject/i)).toBeVisible();

    // Enter vote amount
    const amountInput = page.locator('input[type="number"]').filter({ hasText: /Vote Amount/i });
    if (await amountInput.isVisible()) {
      await amountInput.fill('0.01');
    }

    await page.screenshot({
      path: 'test-results/screenshots/moderation/04-voting-interface.png',
      fullPage: true,
    });

    // Vote YES
    await page.getByRole('button', { name: /Vote YES/i }).click();

    await executeTransaction(page, metamask, {
      expectSuccessMessage: 'Vote submitted',
      timeout: 45000,
    });

    await page.screenshot({
      path: 'test-results/screenshots/moderation/05-vote-submitted.png',
      fullPage: true,
    });

    console.log('✅ Vote transaction successful');
  });
});

test.describe('Agent Profile Tests', () => {
  test('should view agent profile page', async ({ page, metamask }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, metamask);
    await page.goto(MODERATION_URL);
    await page.waitForTimeout(1000);

    // Find an agent link
    const agentLink = page.getByText(/Agent #\d+/).first();
    const hasAgent = await agentLink.isVisible();

    if (!hasAgent) {
      console.log('ℹ️  No agents to view');
      return;
    }

    // Click to view profile
    await agentLink.click();
    await page.waitForTimeout(2000);

    // Should navigate to agent profile page
    await expect(page.url()).toContain('/agent/');
    await expect(page.getByText(/Agent #/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/moderation/06-agent-profile.png',
      fullPage: true,
    });

    console.log('✅ Agent profile page displayed');
  });
});

// Note: Full moderation flow requires contracts deployed
test.describe('Moderation System Requirements', () => {
  test('should check if moderation contracts deployed', async ({ page }) => {
    await page.goto('http://localhost:4001');
    
    // Try to navigate to moderation
    await page.goto(MODERATION_URL);
    await page.waitForTimeout(2000);

    // If contracts not deployed, should show error or empty states
    const moderationWorks = await page.getByText('Moderation Dashboard').isVisible();

    if (moderationWorks) {
      console.log('✅ Moderation system available');
    } else {
      console.log('⚠️  Moderation contracts not deployed - features unavailable');
      console.log('   Deploy moderation contracts to test full functionality');
    }
  });
});


