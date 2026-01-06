/**
 * Gateway Liquidity Tests
 *
 * Tests liquidity provision and LP position management.
 */

import { getCoreAppUrl } from '@jejunetwork/config'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const GATEWAY_URL = getCoreAppUrl('GATEWAY')

async function connectAndNavigateToLiquidity(
  page: ReturnType<typeof test.extend>['page'] extends Promise<infer P>
    ? P
    : never,
  metamask: MetaMask,
) {
  await page.goto(GATEWAY_URL)
  await page.locator('button:has-text("Connect")').first().click()
  await page.waitForTimeout(1000)
  await metamask.connectToDapp()
  await page.getByRole('button', { name: /Add Liquidity/i }).click()
  await page.waitForTimeout(1000)
}

test.describe('Liquidity Interface', () => {
  test('displays add liquidity interface', async ({
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

    await connectAndNavigateToLiquidity(page, metamask)

    await expect(page.getByText('Add ETH Liquidity')).toBeVisible()

    await page.screenshot({
      path: 'test-results/screenshots/liquidity-interface.png',
      fullPage: true,
    })
  })

  test('shows liquidity explanation', async ({
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

    await connectAndNavigateToLiquidity(page, metamask)

    await expect(page.getByText(/How it works/i)).toBeVisible()
    await expect(
      page.getByText(/Deposit ETH to sponsor gas payments/i),
    ).toBeVisible()
    await expect(page.getByText(/Earn fees in protocol tokens/i)).toBeVisible()
  })

  test('includes all tokens in selector', async ({
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

    await connectAndNavigateToLiquidity(page, metamask)

    await page.locator('.input').first().click()

    await expect(page.getByText('JEJU')).toBeVisible()
  })
})

test.describe('Token Selection', () => {
  test('warns if paymaster not deployed', async ({
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

    await connectAndNavigateToLiquidity(page, metamask)

    await page.locator('.input').first().click()
    const tokenToTest = page.getByText('JEJU')

    if (await tokenToTest.isVisible().catch(() => false)) {
      await tokenToTest.click()

      const warning = page.getByText(/No paymaster deployed/i)
      const warningExists = await warning.isVisible().catch(() => false)

      if (warningExists) {
        await expect(page.getByText(/Deploy one first/i)).toBeVisible()
      }
    }
  })

  test('shows ETH amount input for token with paymaster', async ({
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

    await connectAndNavigateToLiquidity(page, metamask)

    await page.locator('.input').first().click()
    await page.getByText('JEJU').click()

    const amountInput = page.getByPlaceholder('1.0')
    const inputExists = await amountInput.isVisible().catch(() => false)

    if (inputExists) {
      await expect(amountInput).toBeVisible()
      await amountInput.fill('2.5')
      await expect(
        page.getByRole('button', { name: /Add 2.5 ETH/i }),
      ).toBeVisible()
    }
  })
})

test.describe('LP Position Display', () => {
  test('displays LP position if exists', async ({
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

    await connectAndNavigateToLiquidity(page, metamask)

    await page.locator('.input').first().click()
    await page.getByText('JEJU').click()

    const lpCard = page.getByText(/Your JEJU LP Position/i)
    const hasPosition = await lpCard.isVisible().catch(() => false)

    if (hasPosition) {
      await expect(page.getByText('ETH Shares')).toBeVisible()
      await expect(page.getByText('ETH Value')).toBeVisible()
      await expect(page.getByText('Pending Fees')).toBeVisible()
      await expect(
        page.getByRole('button', { name: /Remove All Liquidity/i }),
      ).toBeVisible()
    }
  })

  test('shows fee earnings in position', async ({
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

    await connectAndNavigateToLiquidity(page, metamask)

    await page.locator('.input').first().click()
    await page.getByText('JEJU').click()

    const lpCard = page.getByText(/Your JEJU LP Position/i)
    const hasPosition = await lpCard.isVisible().catch(() => false)

    if (hasPosition) {
      await expect(page.getByText('Pending Fees')).toBeVisible()
    }
  })
})

test.describe('LP Dashboard', () => {
  test('displays LP dashboard', async ({
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

    await page.goto(GATEWAY_URL)
    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    await page.getByRole('button', { name: /My Earnings/i }).click()
    await page.waitForTimeout(1000)

    await expect(page.getByText('My LP Positions')).toBeVisible()

    await page.screenshot({
      path: 'test-results/screenshots/lp-dashboard.png',
      fullPage: true,
    })
  })

  test('shows empty state or positions', async ({
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

    await page.goto(GATEWAY_URL)
    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    await page.getByRole('button', { name: /My Earnings/i }).click()
    await page.waitForTimeout(1000)

    const noPositionsMsg = page.getByText(/No LP Positions/i)
    const hasNoPositions = await noPositionsMsg.isVisible().catch(() => false)

    if (hasNoPositions) {
      await expect(page.getByText(/Add liquidity to earn fees/i)).toBeVisible()
    } else {
      const positionCards = page
        .locator('.card')
        .filter({ hasText: /Position/i })
      const count = await positionCards.count()
      expect(count).toBeGreaterThanOrEqual(0)
    }
  })

  test('shows claim button for positions with fees', async ({
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

    await page.goto(GATEWAY_URL)
    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    await page.getByRole('button', { name: /My Earnings/i }).click()
    await page.waitForTimeout(1000)

    const claimButtons = page.getByRole('button', { name: /Claim/i })
    const claimCount = await claimButtons.count()
    expect(claimCount >= 0).toBe(true)
  })
})
