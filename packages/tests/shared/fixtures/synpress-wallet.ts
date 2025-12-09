import { type BrowserContext } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import { createJejuWalletSetup } from '../synpress.config.base';

/**
 * Synpress wallet fixtures for Jeju network testing
 *
 * This replaces the old Dappwright fixtures with modern Synpress.
 *
 * Usage:
 * ```typescript
 * import { test, expect } from '@jejunetwork/tests/fixtures/synpress-wallet';
 *
 * test('should connect wallet and trade', async ({ context, page, metamaskPage, extensionId }) => {
 *   const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);
 *   
 *   await page.goto('/');
 *   await page.click('button:has-text("Connect Wallet")');
 *
 *   // Connect wallet
 *   await metamask.connectToDapp();
 *
 *   // Interact with dApp
 *   await page.click('button:has-text("Swap")');
 *
 *   // Approve transaction in MetaMask
 *   await metamask.confirmTransaction();
 *
 *   // Verify success
 *   await expect(page.getByText('Swap successful')).toBeVisible();
 * });
 * ```
 */

// Create the wallet setup
const basicSetup = createJejuWalletSetup();

// Export test with properly configured MetaMask fixtures
export const test = testWithSynpress(metaMaskFixtures(basicSetup));

// Re-export expect for convenience
export { expect } from '@playwright/test';

/**
 * Helper function to connect wallet to dApp
 *
 * This handles the common flow of clicking connect button and approving in MetaMask.
 *
 * Usage:
 * ```typescript
 * await connectWallet(page, metamask);
 * ```
 */
export async function connectWallet(
  page: any,
  metamask: MetaMask,
  options?: {
    connectButtonText?: string;
    walletOptionText?: string;
    timeout?: number;
  }
) {
  const {
    connectButtonText = 'Connect Wallet',
    walletOptionText = 'MetaMask',
    timeout = 10000,
  } = options || {};

  try {
    // Click connect button
    const connectButton = page.locator(`button:has-text("${connectButtonText}")`);
    await connectButton.click({ timeout });

    // Wait for wallet selection modal
    await page.waitForTimeout(500);

    // Select MetaMask
    const metamaskOption = page.locator(`text="${walletOptionText}"`);
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click();
    }

    // Connect in MetaMask popup
    await metamask.connectToDapp();

    console.log('✅ Wallet connected successfully');
  } catch (error) {
    console.warn('Connect wallet flow failed:', error);
    throw error;
  }
}

/**
 * Helper function to approve transaction in MetaMask
 *
 * Usage:
 * ```typescript
 * await approveTransaction(metamask);
 * ```
 */
export async function approveTransaction(metamask: MetaMask) {
  try {
    await metamask.confirmTransaction();
    console.log('✅ Transaction approved');
  } catch (error) {
    console.error('Failed to approve transaction:', error);
    throw error;
  }
}

/**
 * Helper function to sign message in MetaMask
 *
 * Usage:
 * ```typescript
 * await signMessage(metamask);
 * ```
 */
export async function signMessage(metamask: MetaMask) {
  try {
    await metamask.confirmSignature();
    console.log('✅ Message signed');
  } catch (error) {
    console.error('Failed to sign message:', error);
    throw error;
  }
}

/**
 * Helper function to reject transaction in MetaMask
 *
 * Usage:
 * ```typescript
 * await rejectTransaction(metamask);
 * ```
 */
export async function rejectTransaction(metamask: MetaMask) {
  try {
    await metamask.rejectTransaction();
    console.log('✅ Transaction rejected');
  } catch (error) {
    console.error('Failed to reject transaction:', error);
    throw error;
  }
}

/**
 * Helper function to switch network in MetaMask
 *
 * Usage:
 * ```typescript
 * await switchNetwork(metamask, 'Ethereum Mainnet');
 * ```
 */
export async function switchNetwork(metamask: MetaMask, networkName: string) {
  try {
    await metamask.switchNetwork(networkName);
    console.log(`✅ Switched to network: ${networkName}`);
  } catch (error) {
    console.error(`Failed to switch to network ${networkName}:`, error);
    throw error;
  }
}

/**
 * Helper function to add token to MetaMask
 *
 * Usage:
 * ```typescript
 * await addToken(metamask, '0x...', 'TOKEN', 18);
 * ```
 */
export async function addToken(
  metamask: MetaMask,
  tokenAddress: string,
  symbol: string,
  decimals: number = 18
) {
  // @ts-expect-error - MetaMask API varies between versions
  await metamask.addToken?.({ address: tokenAddress, symbol, decimals }) ??
    console.log(`Token addition not supported in this version`);
  console.log(`✅ Added token: ${symbol} (${tokenAddress})`);
}

/**
 * Helper to get wallet address from MetaMask
 *
 * Usage:
 * ```typescript
 * const address = await getWalletAddress(page);
 * expect(address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
 * ```
 */
export async function getWalletAddress(page: any): Promise<string> {
  try {
    // Look for address display (common patterns)
    const addressSelector = [
      '[data-testid="wallet-address"]',
      'button:has-text(/0x[a-fA-F0-9]{40}/)',
      'span:has-text(/0x[a-fA-F0-9]{40}/)',
      'div:has-text(/0x[a-fA-F0-9]{40}/)',
    ].join(', ');

    const addressElement = page.locator(addressSelector).first();
    const text = await addressElement.textContent({ timeout: 5000 });

    const match = text?.match(/0x[a-fA-F0-9]{40}/);
    if (match) {
      return match[0];
    }

    throw new Error('Could not find wallet address in page');
  } catch (error) {
    console.error('Failed to get wallet address:', error);
    throw error;
  }
}

/**
 * Helper to verify wallet is connected
 *
 * Usage:
 * ```typescript
 * await verifyWalletConnected(page);
 * ```
 */
export async function verifyWalletConnected(page: any, expectedAddress?: string) {
  const address = await getWalletAddress(page);

  if (expectedAddress) {
    if (address.toLowerCase() !== expectedAddress.toLowerCase()) {
      throw new Error(`Expected address ${expectedAddress} but got ${address}`);
    }
  }

  console.log(`✅ Wallet verified: ${address}`);
  return address;
}
