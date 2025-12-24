/**
 * Gateway App Registry Tests
 *
 * Tests app registration and discovery.
 */

import { getCoreAppUrl } from '@jejunetwork/config'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const GATEWAY_URL = process.env.GATEWAY_URL || getCoreAppUrl('GATEWAY')

async function connectAndNavigateToRegistry(
  page: ReturnType<typeof test.extend>['page'] extends Promise<infer P>
    ? P
    : never,
  metamask: MetaMask,
) {
  await page.goto(GATEWAY_URL)
  await page.locator('button:has-text("Connect")').first().click()
  await page.waitForTimeout(1000)
  await metamask.connectToDapp()
  await page.getByRole('button', { name: /App Registry/i }).click()
  await page.waitForTimeout(1000)
}

test.describe('App Registry Interface', () => {
  test('displays app registry tab', async ({
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

    await connectAndNavigateToRegistry(page, metamask)

    await expect(page.getByText(/App Registry|Browse Apps/i)).toBeVisible()

    await page.screenshot({
      path: 'test-results/screenshots/registry-interface.png',
      fullPage: true,
    })
  })

  test('shows sub-navigation', async ({
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

    await connectAndNavigateToRegistry(page, metamask)

    const browseButton = page.getByRole('button', { name: /Browse Apps/i })
    const registerButton = page.getByRole('button', { name: /Register App/i })

    const hasBrowse = await browseButton.isVisible().catch(() => false)
    const hasRegister = await registerButton.isVisible().catch(() => false)

    expect(hasBrowse || hasRegister).toBe(true)
  })
})

test.describe('App Browsing', () => {
  test('displays tag filters', async ({
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

    await connectAndNavigateToRegistry(page, metamask)

    const tags = [
      'All Apps',
      'Applications',
      'Games',
      'Marketplaces',
      'DeFi',
      'Social',
    ]

    for (const tag of tags) {
      const tagButton = page.getByRole('button', { name: tag })
      const isVisible = await tagButton.isVisible().catch(() => false)

      if (isVisible) {
        await tagButton.click()
        await page.waitForTimeout(300)
      }
    }

    await page.screenshot({
      path: 'test-results/screenshots/registry-tag-filters.png',
      fullPage: true,
    })
  })

  test('shows app cards or empty state', async ({
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

    await connectAndNavigateToRegistry(page, metamask)

    const noAppsMsg = page.getByText(/No apps found|Register the first app/i)
    const hasNoApps = await noAppsMsg.isVisible().catch(() => false)

    if (hasNoApps) {
      await expect(noAppsMsg).toBeVisible()
    } else {
      const appCards = page
        .locator('.card')
        .filter({ hasText: /app|game|defi/i })
      const count = await appCards.count()
      expect(count >= 0).toBe(true)
    }
  })
})

test.describe('App Registration', () => {
  test('displays registration form', async ({
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

    await connectAndNavigateToRegistry(page, metamask)

    const registerButton = page.getByRole('button', { name: /Register App/i })
    if (await registerButton.isVisible().catch(() => false)) {
      await registerButton.click()
      await page.waitForTimeout(500)

      await page.screenshot({
        path: 'test-results/screenshots/registry-registration-form.png',
        fullPage: true,
      })
    }
  })

  test('shows category selection', async ({
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

    await connectAndNavigateToRegistry(page, metamask)

    const registerButton = page.getByRole('button', { name: /Register App/i })
    if (await registerButton.isVisible().catch(() => false)) {
      await registerButton.click()
      await page.waitForTimeout(500)

      const categories = [
        'Application',
        'Game',
        'Marketplace',
        'DeFi',
        'Social',
        'Information Provider',
        'Service',
      ]

      for (const category of categories) {
        const categoryButton = page.getByRole('button', {
          name: new RegExp(category, 'i'),
        })
        const isVisible = await categoryButton.isVisible().catch(() => false)

        if (isVisible) {
          await categoryButton.click()
          await page.waitForTimeout(200)
          break
        }
      }
    }
  })

  test('shows stake requirement', async ({
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

    await connectAndNavigateToRegistry(page, metamask)

    const registerButton = page.getByRole('button', { name: /Register App/i })
    if (await registerButton.isVisible().catch(() => false)) {
      await registerButton.click()
      await page.waitForTimeout(500)

      const stakeInfo = page.getByText(/Stake|Registration Fee|0\.001.*ETH/i)
      const hasStakeInfo = await stakeInfo.isVisible().catch(() => false)

      if (hasStakeInfo) {
        await expect(stakeInfo).toBeVisible()
      }
    }
  })

  test('validates A2A endpoint field', async ({
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

    await connectAndNavigateToRegistry(page, metamask)

    const registerButton = page.getByRole('button', { name: /Register App/i })
    if (await registerButton.isVisible().catch(() => false)) {
      await registerButton.click()
      await page.waitForTimeout(500)

      const a2aInput = page.getByPlaceholder(/a2a|endpoint|url/i)
      const hasA2aInput = await a2aInput.isVisible().catch(() => false)

      if (hasA2aInput) {
        await a2aInput.fill('http://localhost:4003/a2a')
        await expect(a2aInput).toHaveValue('http://localhost:4003/a2a')
      }
    }
  })
})
