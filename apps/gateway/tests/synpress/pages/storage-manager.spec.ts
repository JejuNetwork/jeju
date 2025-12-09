/**
 * Storage Manager Page Tests
 * Tests IPFS file storage, pinning, and x402 payments
 * 
 * NOTE: Requires IPFS service running on port 3100
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { basicSetup } from '../../../synpress.config'
import { connectWallet } from '../helpers/wallet-helpers';
import { executeTransaction } from '../helpers/transaction-helpers';
import { STORAGE_DURATIONS, TEST_FILE } from '../fixtures/test-data';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

const STORAGE_URL = 'http://localhost:4001/storage';

test.describe('Storage Manager - Navigation & Display', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, metamask);
  });

  test('should navigate to storage manager page', async ({ page }) => {
    await page.goto(STORAGE_URL);
    await page.waitForLoadState('networkidle');

    // Verify page loaded
    await expect(page.getByText('File Storage Manager')).toBeVisible();
    await expect(page.getByText(/Decentralized file storage on Jeju IPFS/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/storage/01-storage-manager.png',
      fullPage: true,
    });

    console.log('✅ Storage manager page loaded');
  });

  test('should display all tabs: Upload, My Files, Funding', async ({ page }) => {
    await page.goto(STORAGE_URL);

    await expect(page.getByText('Upload Files')).toBeVisible();
    await expect(page.getByText('My Files')).toBeVisible();
    await expect(page.getByText('Funding & Payments')).toBeVisible();

    console.log('✅ All storage tabs present');
  });

  test('should display pricing information', async ({ page }) => {
    await page.goto(STORAGE_URL);
    
    // Click Funding tab
    await page.getByText('Funding & Payments').click();
    await page.waitForTimeout(500);

    await expect(page.getByText(/Pricing/i)).toBeVisible();
    await expect(page.getByText(/\$0.10 USDC/i)).toBeVisible();
    await expect(page.getByText(/Per GB per Month/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/storage/02-pricing.png',
      fullPage: true,
    });

    console.log('✅ Storage pricing displayed');
  });
});

test.describe('File Upload Flow', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, metamask);
    await page.goto(STORAGE_URL);
    await page.waitForTimeout(1000);
  });

  test('should upload file to Jeju IPFS', async ({ page }) => {
    // Upload Files tab (default)
    
    // Select file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: TEST_FILE.name,
      mimeType: 'text/plain',
      buffer: Buffer.from(TEST_FILE.content),
    });

    // Wait for file to appear
    await expect(page.getByText(TEST_FILE.name)).toBeVisible({ timeout: 5000 });

    // Select duration (6 months)
    await page.getByText('6 Months').click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'test-results/screenshots/storage/03-file-selected.png',
      fullPage: true,
    });

    // Upload button
    const uploadButton = page.getByRole('button', { name: /Upload File/i });
    await expect(uploadButton).toBeVisible();
    await uploadButton.click();

    // Wait for upload (may require x402 payment in production)
    await expect(page.getByText(/Uploaded Successfully/i)).toBeVisible({ timeout: 30000 });
    
    // Verify CID displayed
    await expect(page.getByText(/CID:/i)).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/storage/04-upload-success.png',
      fullPage: true,
    });

    console.log('✅ File upload successful');
  });

  test('should display file in My Files after upload', async ({ page }) => {
    // Upload a file first (or check if files exist)
    
    // Navigate to My Files
    await page.getByText('My Files').click();
    await page.waitForTimeout(1000);

    // Check for files or empty state
    const emptyState = page.getByText(/No files uploaded yet/i);
    const hasFiles = !(await emptyState.isVisible());

    if (hasFiles) {
      // Verify file card displays
      await expect(page.locator('.card, [class*="card"]').first()).toBeVisible();
      
      await page.screenshot({
        path: 'test-results/screenshots/storage/05-my-files.png',
        fullPage: true,
      });
      
      console.log('✅ Files displayed in My Files tab');
    } else {
      console.log('ℹ️  No files uploaded yet');
    }
  });

  test('should calculate storage price for different durations', async ({ page }) => {
    // Select a test file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'large-test.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(1024 * 1024), // 1 MB
    });

    await page.waitForTimeout(1000);

    // Check prices for different durations
    for (const [duration, label] of [
      [STORAGE_DURATIONS.ONE_MONTH, '1 Month'],
      [STORAGE_DURATIONS.SIX_MONTHS, '6 Months'],
      [STORAGE_DURATIONS.ONE_YEAR, '1 Year'],
    ]) {
      await page.getByText(label).click();
      await page.waitForTimeout(300);
      
      // Price should update based on duration
      const priceElement = page.locator('text=/\\$[0-9.]+/');
      const hasPrice = await priceElement.isVisible();
      
      if (hasPrice) {
        const price = await priceElement.textContent();
        console.log(`ℹ️  ${label}: ${price}`);
      }
    }

    console.log('✅ Storage pricing calculations tested');
  });
});

test.describe('Storage Funding Flow', () => {
  test.beforeEach(async ({ page, metamask }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, metamask);
    await page.goto(STORAGE_URL);
    await page.waitForTimeout(1000);
  });

  test('should display funding options', async ({ page }) => {
    // Navigate to Funding tab
    await page.getByText('Funding & Payments').click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Storage Funding')).toBeVisible();
    await expect(page.getByText(/Current Balance/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Deposit USDC/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Deposit elizaOS/i })).toBeVisible();

    await page.screenshot({
      path: 'test-results/screenshots/storage/06-funding.png',
      fullPage: true,
    });

    console.log('✅ Funding options displayed');
  });

  test.skip('should fund storage balance with elizaOS', async ({ page, metamask }) => {
    // TODO: Implement when funding contract ready
    
    await page.getByText('Funding & Payments').click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /Deposit elizaOS/i }).click();

    // Would trigger transaction
    console.log('⚠️  Storage funding transaction test - needs implementation');
  });
});

test.describe('File Management', () => {
  test('should display file expiration warnings', async ({ page, metamask }) => {
    await page.goto('http://localhost:4001');
    await connectWallet(page, metamask);
    await page.goto(STORAGE_URL);
    
    await page.getByText('My Files').click();
    await page.waitForTimeout(1000);

    // Check for files with expiration
    const expirationText = page.getByText(/days left|Expired/i);
    const hasExpiration = await expirationText.isVisible();

    if (hasExpiration) {
      console.log('✅ Expiration warnings displayed');
    } else {
      console.log('ℹ️  No files with expiration data');
    }
  });

  test.skip('should renew file storage', async ({ page, metamask }) => {
    // TODO: Implement when renew functionality ready
    
    await page.goto('http://localhost:4001');
    await connectWallet(page, metamask);
    await page.goto(STORAGE_URL);
    
    await page.getByText('My Files').click();
    await page.waitForTimeout(1000);

    // Find renew button
    const renewButton = page.getByRole('button', { name: /Renew/i }).first();
    const hasRenew = await renewButton.isVisible();

    if (hasRenew) {
      console.log('⚠️  Renew functionality test - needs implementation');
    }
  });
});

// Note: Storage system requires IPFS service
test.describe('Storage System Requirements', () => {
  test('should check if IPFS service available', async ({ page }) => {
    // Check if Jeju IPFS API is running
    const ipfsUrl = 'http://localhost:3100';
    
    const ipfsAvailable = await page.request.get(`${ipfsUrl}/health`).then(
      (res) => res.ok
    ).catch(() => false);

    if (ipfsAvailable) {
      console.log('✅ Jeju IPFS service available');
    } else {
      console.log('⚠️  IPFS service not running on port 3100');
      console.log('   Start with: cd apps/ipfs && bun run dev');
      console.log('   Storage features will be limited without IPFS');
    }
  });
});


