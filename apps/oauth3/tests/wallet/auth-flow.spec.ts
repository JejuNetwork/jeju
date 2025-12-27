/**
 * Wallet authentication flow tests with Synpress
 */

// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { defineWalletSetup, testWithSynpress } from '@synthetixio/synpress'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'

const SEED_PHRASE =
  'test test test test test test test test test test test junk'
const PASSWORD = 'Tester@1234'

const basicSetup = defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD)
  await metamask.importWallet(SEED_PHRASE)
})

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test('should load wallet challenge page', async ({ page }) => {
  await page.goto(
    '/wallet/challenge?client_id=jeju-default&redirect_uri=http://localhost:3000/callback&state=test',
  )

  await expect(page.locator('text=Connect Wallet')).toBeVisible()
  await expect(page.locator('button#connectBtn')).toBeVisible()
})

test('should display message to sign', async ({ page }) => {
  await page.goto(
    '/wallet/challenge?client_id=jeju-default&redirect_uri=http://localhost:3000/callback&state=test',
  )

  await expect(page.locator('.message-box')).toContainText(
    'Sign this message to authenticate',
  )
  await expect(page.locator('.message-box')).toContainText(
    'auth.jejunetwork.org',
  )
})

test('should connect wallet and sign message', async ({
  context,
  page,
  metamaskPage,
  extensionId,
}) => {
  const metamask = new MetaMask(
    context,
    metamaskPage,
    basicSetup.walletPassword,
    extensionId,
  )

  await page.goto(
    '/wallet/challenge?client_id=jeju-default&redirect_uri=http://localhost:3000/callback&state=test',
  )

  // Click connect
  await page.locator('#connectBtn').click()

  // Connect MetaMask
  await metamask.connectToDapp()

  // Should prompt for signature
  await metamask.confirmSignature()

  // Should redirect after successful auth
  await page.waitForURL(/localhost:3000\/callback/)

  // Should have code in URL
  const url = new URL(page.url())
  expect(url.searchParams.get('code')).toBeTruthy()
  expect(url.searchParams.get('state')).toBe('test')
})
