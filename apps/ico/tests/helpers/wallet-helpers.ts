import { MetaMask } from '@synthetixio/synpress/playwright';
import { Page, BrowserContext } from '@playwright/test';

const PASSWORD = 'Tester@1234';

export async function connectWallet(page: Page, metamask: MetaMask): Promise<void> {
  await page.waitForLoadState('networkidle');

  const connectButton = page.getByRole('button', { name: /Connect Wallet/i });
  await connectButton.click();
  await page.waitForTimeout(1000);

  await metamask.connectToDapp();
  await page.waitForSelector('text=/0x/', { timeout: 15000 });
}

export function createMetaMask(context: BrowserContext, metamaskPage: Page, extensionId: string): MetaMask {
  return new MetaMask(context, metamaskPage, PASSWORD, extensionId);
}

export async function isWalletConnected(page: Page): Promise<boolean> {
  const walletButton = page.locator('text=/0x/');
  return walletButton.isVisible();
}

export async function getConnectedAddress(page: Page): Promise<string | null> {
  const walletElement = page.locator('text=/0xf39F/i').first();
  const isVisible = await walletElement.isVisible();
  return isVisible ? '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' : null;
}
