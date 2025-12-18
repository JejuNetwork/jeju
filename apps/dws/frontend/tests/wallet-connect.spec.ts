import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup from '../wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test('should connect wallet and show dashboard', async ({
  context,
  page,
  metamaskPage,
  extensionId,
}) => {
  const metamask = new MetaMask(
    context,
    metamaskPage,
    basicSetup.walletPassword,
    extensionId
  );

  await page.goto('/');
  await expect(page.locator('text=Welcome to DWS Console')).toBeVisible();

  await page.locator('button:has-text("Connect Wallet")').click();
  await metamask.connectToDapp();

  await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible();
});

test('should show containers page when connected', async ({
  context,
  page,
  metamaskPage,
  extensionId,
}) => {
  const metamask = new MetaMask(
    context,
    metamaskPage,
    basicSetup.walletPassword,
    extensionId
  );

  await page.goto('/');
  await page.locator('button:has-text("Connect Wallet")').click();
  await metamask.connectToDapp();

  await page.click('text=Containers');
  await expect(page).toHaveURL('/compute/containers');
  await expect(page.locator('button:has-text("Run Container")')).toBeVisible();
});

test('should show workers page when connected', async ({
  context,
  page,
  metamaskPage,
  extensionId,
}) => {
  const metamask = new MetaMask(
    context,
    metamaskPage,
    basicSetup.walletPassword,
    extensionId
  );

  await page.goto('/');
  await page.locator('button:has-text("Connect Wallet")').click();
  await metamask.connectToDapp();

  await page.click('text=Workers');
  await expect(page).toHaveURL('/compute/workers');
  await expect(page.locator('button:has-text("Deploy Worker")')).toBeVisible();
});

test('should show billing page with balance when connected', async ({
  context,
  page,
  metamaskPage,
  extensionId,
}) => {
  const metamask = new MetaMask(
    context,
    metamaskPage,
    basicSetup.walletPassword,
    extensionId
  );

  await page.goto('/');
  await page.locator('button:has-text("Connect Wallet")').click();
  await metamask.connectToDapp();

  await page.click('text=Billing');
  await expect(page).toHaveURL('/billing');
  await expect(page.locator('text=x402 Balance')).toBeVisible();
  await expect(page.locator('button:has-text("Add Credits")')).toBeVisible();
});

test('should switch to provider mode when connected', async ({
  context,
  page,
  metamaskPage,
  extensionId,
}) => {
  const metamask = new MetaMask(
    context,
    metamaskPage,
    basicSetup.walletPassword,
    extensionId
  );

  await page.goto('/');
  await page.locator('button:has-text("Connect Wallet")').click();
  await metamask.connectToDapp();

  await page.locator('button:has-text("Provider")').click();
  await expect(page.locator('h1')).toContainText('Provider Dashboard');
  await expect(page.locator('text=Your Nodes')).toBeVisible();
  await expect(page.locator('text=Earnings')).toBeVisible();
});


