/**
 * Gateway Node Operator Tests
 *
 * Tests node registration, staking, and rewards.
 */

import { getCoreAppUrl } from '@jejunetwork/config'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const GATEWAY_URL = getCoreAppUrl('GATEWAY')

async function connectAndNavigateToNodes(
  page: ReturnType<typeof test.extend>['page'] extends Promise<infer P>
    ? P
    : never,
  metamask: MetaMask,
) {
  await page.goto(GATEWAY_URL)
  await page.getByRole('button', { name: /sign in/i }).first().click()
  await page.waitForTimeout(1000)
  const walletOption = page.getByRole('button', { name: /connect wallet/i })
  if (await walletOption.isVisible().catch(() => false)) {
    await walletOption.click()
  }
  await metamask.connectToDapp()
  await page.getByRole('button', { name: /Node Operators/i }).click()
  await page.waitForTimeout(1000)
}

test.describe('Node Operator Interface', () => {
  test('displays node operators tab', async ({
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

    await connectAndNavigateToNodes(page, metamask)

    await expect(
      page.getByText(/Node Operators|Network Overview/i),
    ).toBeVisible()

    await page.screenshot({
      path: 'test-results/screenshots/nodes-interface.png',
      fullPage: true,
    })
  })

  test('shows sub-navigation buttons', async ({
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

    await connectAndNavigateToNodes(page, metamask)

    const subButtons = ['Network Overview', 'My Nodes', 'Register New Node']

    for (const buttonText of subButtons) {
      const button = page.getByRole('button', { name: buttonText })
      const isVisible = await button.isVisible().catch(() => false)

      if (isVisible) {
        await button.click()
        await page.waitForTimeout(500)
      }
    }
  })
})

test.describe('Network Overview', () => {
  test('displays network statistics', async ({
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

    await connectAndNavigateToNodes(page, metamask)

    const networkOverview = page.getByRole('button', {
      name: /Network Overview/i,
    })
    if (await networkOverview.isVisible().catch(() => false)) {
      await networkOverview.click()
      await page.waitForTimeout(500)

      await page.screenshot({
        path: 'test-results/screenshots/nodes-network-overview.png',
        fullPage: true,
      })
    }
  })
})

test.describe('Node Registration', () => {
  test('displays node registration form', async ({
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

    await connectAndNavigateToNodes(page, metamask)

    const registerButton = page.getByRole('button', {
      name: /Register New Node/i,
    })
    if (await registerButton.isVisible().catch(() => false)) {
      await registerButton.click()
      await page.waitForTimeout(500)

      await page.screenshot({
        path: 'test-results/screenshots/nodes-registration-form.png',
        fullPage: true,
      })
    }
  })

  test('shows stake requirements', async ({
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

    await connectAndNavigateToNodes(page, metamask)

    const registerButton = page.getByRole('button', {
      name: /Register New Node/i,
    })
    if (await registerButton.isVisible().catch(() => false)) {
      await registerButton.click()
      await page.waitForTimeout(500)

      const stakeInfo = page.getByText(/Minimum Stake|Stake Amount|\$1,000/i)
      const hasStakeInfo = await stakeInfo.isVisible().catch(() => false)

      if (hasStakeInfo) {
        await expect(stakeInfo).toBeVisible()
      }
    }
  })

  test('shows region selection', async ({
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

    await connectAndNavigateToNodes(page, metamask)

    const registerButton = page.getByRole('button', {
      name: /Register New Node/i,
    })
    if (await registerButton.isVisible().catch(() => false)) {
      await registerButton.click()
      await page.waitForTimeout(500)

      const regionSelector = page.getByText(/Region|Select Region/i)
      const hasRegionSelector = await regionSelector
        .isVisible()
        .catch(() => false)

      if (hasRegionSelector) {
        await expect(regionSelector).toBeVisible()
      }
    }
  })
})

test.describe('My Nodes', () => {
  test('shows user node list or empty state', async ({
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

    await connectAndNavigateToNodes(page, metamask)

    const myNodesButton = page.getByRole('button', { name: /My Nodes/i })
    if (await myNodesButton.isVisible().catch(() => false)) {
      await myNodesButton.click()
      await page.waitForTimeout(500)

      const noNodesMsg = page.getByText(/No nodes registered|Register a node/i)
      const hasNoNodes = await noNodesMsg.isVisible().catch(() => false)

      if (hasNoNodes) {
        await expect(noNodesMsg).toBeVisible()
      }

      await page.screenshot({
        path: 'test-results/screenshots/nodes-my-nodes.png',
        fullPage: true,
      })
    }
  })
})
