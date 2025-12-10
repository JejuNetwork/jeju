import { type Page } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { createJejuWalletSetup, TEST_WALLET_ADDRESS } from '../synpress.config.base';

/**
 * Synpress wallet fixtures for Jeju network testing
 *
 * Usage:
 * ```typescript
 * import { test, expect, connectAndVerify } from '@jejunetwork/tests/fixtures/synpress-wallet';
 *
 * test('should connect wallet and trade', async ({ context, page, metamaskPage, extensionId }) => {
 *   const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);
 *   await connectAndVerify(page, metamask);
 *   
 *   // Interact with dApp
 *   await page.click('button:has-text("Swap")');
 *   await metamask.confirmTransaction();
 * });
 * ```
 */

// Create the wallet setup
const basicSetup = createJejuWalletSetup();

// Export test with properly configured MetaMask fixtures
export const test = testWithSynpress(metaMaskFixtures(basicSetup));

// Re-export expect for convenience
export { expect } from '@playwright/test';

// Export wallet password for MetaMask initialization
export const walletPassword = basicSetup.walletPassword;

// Export the basic setup for apps that need it
export { basicSetup };

/**
 * Connect wallet and verify connection in one step
 * Combines connectWallet and verifyAuth for common use case
 */
export async function connectAndVerify(
  page: Page,
  metamask: MetaMask,
  options?: {
    connectButtonText?: string | RegExp;
    walletOptionText?: string;
    expectedAddress?: string;
    timeout?: number;
  }
): Promise<string> {
  const {
    connectButtonText = /Connect/i,
    walletOptionText = 'MetaMask',
    expectedAddress = TEST_WALLET_ADDRESS,
    timeout = 15000,
  } = options || {};

  // Find and click connect button
  const connectButton = typeof connectButtonText === 'string' 
    ? page.getByRole('button', { name: connectButtonText })
    : page.getByRole('button', { name: connectButtonText });
  
  await connectButton.click({ timeout });
  await page.waitForTimeout(500);

  // Select MetaMask if wallet picker is shown
  const metamaskOption = page.locator(`text="${walletOptionText}"`);
  if (await metamaskOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    await metamaskOption.click();
  }

  // Connect in MetaMask popup
  await metamask.connectToDapp();

  // Verify connection
  const address = await verifyAuth(page, { expectedAddress, timeout });
  console.log(`✅ Wallet connected and verified: ${address}`);
  
  return address;
}

/**
 * Validates that a wallet is authenticated/connected to the app
 * Throws if authentication check fails
 */
export async function verifyAuth(
  page: Page,
  options?: {
    expectedAddress?: string;
    timeout?: number;
  }
): Promise<string> {
  const {
    expectedAddress = TEST_WALLET_ADDRESS,
    timeout = 15000,
  } = options || {};

  // Look for truncated wallet address (common pattern: 0xf39F...2266)
  const truncatedPrefix = expectedAddress.slice(0, 6);
  const addressLocator = page.getByText(new RegExp(truncatedPrefix, 'i'));
  
  await addressLocator.waitFor({ state: 'visible', timeout });
  
  // Verify the address matches expected
  const displayedText = await addressLocator.textContent();
  if (!displayedText?.toLowerCase().includes(truncatedPrefix.toLowerCase())) {
    throw new Error(`Auth validation failed: Expected address starting with ${truncatedPrefix}`);
  }

  return expectedAddress;
}

/**
 * Checks if wallet is connected without throwing
 */
export async function isAuthenticated(page: Page, timeout = 5000): Promise<boolean> {
  const truncatedPrefix = TEST_WALLET_ADDRESS.slice(0, 6);
  const addressLocator = page.getByText(new RegExp(truncatedPrefix, 'i'));
  
  return addressLocator.isVisible({ timeout }).catch(() => false);
}

/**
 * Ensures page is not in a connected state
 * Useful for testing disconnect flows or initial state
 */
export async function verifyDisconnected(
  page: Page,
  options?: {
    connectButtonText?: string | RegExp;
    timeout?: number;
  }
): Promise<void> {
  const {
    connectButtonText = /Connect/i,
    timeout = 10000,
  } = options || {};

  const connectButton = page.getByRole('button', { name: connectButtonText });
  await connectButton.waitFor({ state: 'visible', timeout });
  
  // Ensure no wallet address is visible
  const isConnected = await isAuthenticated(page, 2000);
  if (isConnected) {
    throw new Error('Expected wallet to be disconnected but found connected state');
  }
}

/**
 * Connect wallet to dApp
 */
export async function connectWallet(
  page: Page,
  metamask: MetaMask,
  options?: {
    connectButtonText?: string | RegExp;
    walletOptionText?: string;
    timeout?: number;
  }
): Promise<void> {
  const {
    connectButtonText = /Connect/i,
    walletOptionText = 'MetaMask',
    timeout = 10000,
  } = options || {};

  const connectButton = page.getByRole('button', { name: connectButtonText });
  await connectButton.click({ timeout });
  await page.waitForTimeout(500);

  const metamaskOption = page.locator(`text="${walletOptionText}"`);
  if (await metamaskOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    await metamaskOption.click();
  }

  await metamask.connectToDapp();
}

/**
 * Approve transaction in MetaMask
 */
export async function approveTransaction(metamask: MetaMask): Promise<void> {
  await metamask.confirmTransaction();
}

/**
 * Sign message in MetaMask
 */
export async function signMessage(metamask: MetaMask): Promise<void> {
  await metamask.confirmSignature();
}

/**
 * Reject transaction in MetaMask
 */
export async function rejectTransaction(metamask: MetaMask): Promise<void> {
  await metamask.rejectTransaction();
}

/**
 * Switch network in MetaMask
 */
export async function switchNetwork(metamask: MetaMask, networkName: string): Promise<void> {
  await metamask.switchNetwork(networkName);
}

/**
 * Get wallet address displayed on page
 */
export async function getWalletAddress(page: Page): Promise<string> {
  const addressSelector = [
    '[data-testid="wallet-address"]',
    'button:has-text(/0x[a-fA-F0-9]{4,}/)',
    'span:has-text(/0x[a-fA-F0-9]{4,}/)',
    'div:has-text(/0x[a-fA-F0-9]{4,}/)',
  ].join(', ');

  const addressElement = page.locator(addressSelector).first();
  const text = await addressElement.textContent({ timeout: 5000 });

  const match = text?.match(/0x[a-fA-F0-9]{4,}/);
  if (!match) {
    throw new Error('Could not find wallet address in page');
  }

  return match[0];
}

/**
 * Verify wallet is connected (legacy - use verifyAuth instead)
 * @deprecated Use verifyAuth instead
 */
export async function verifyWalletConnected(page: Page, expectedAddress?: string): Promise<string> {
  return verifyAuth(page, { expectedAddress });
}
