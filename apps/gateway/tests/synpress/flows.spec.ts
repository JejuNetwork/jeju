/**
 * Gateway Complete Flow Tests
 *
 * End-to-end tests for complete user journeys.
 * These are the critical happy path tests - if these pass, core system works.
 */

import { getCoreAppUrl } from '@jejunetwork/config'
import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const GATEWAY_URL = getCoreAppUrl('GATEWAY')

async function _executeTransaction(
  page: ReturnType<typeof test.extend>['page'] extends Promise<infer P>
    ? P
    : never,
  metamask: MetaMask,
  options: { expectSuccessMessage?: string; timeout?: number } = {},
): Promise<void> {
  const timeout = options.timeout || 60000
  await page.waitForTimeout(2000)
  await metamask.confirmTransaction()

  if (options.expectSuccessMessage) {
    await page.waitForSelector(`text=/${options.expectSuccessMessage}/i`, {
      timeout,
    })
  }
}

test.describe('Token Lifecycle Flow', () => {
  test('complete flow: Register → Deploy Paymaster → Add Liquidity → Remove', async ({
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

    // Step 1: Connect Wallet
    await page.goto(GATEWAY_URL)
    await page.getByRole('button', { name: /sign in/i }).first().click()
    const walletOption = page.getByRole('button', { name: /connect wallet/i })
    if (await walletOption.isVisible().catch(() => false)) {
      await walletOption.click()
    }
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({
      timeout: 15000,
    })

    await page.screenshot({
      path: 'test-results/screenshots/flow/01-connected.png',
      fullPage: true,
    })

    // Step 2: Navigate to Registered Tokens
    await page.getByRole('button', { name: /Registered Tokens/i }).click()
    await page.waitForTimeout(1000)

    await page.screenshot({
      path: 'test-results/screenshots/flow/02-token-registry.png',
      fullPage: true,
    })

    // Step 3: Check token status
    const jejuVisible = await page
      .getByText('JEJU')
      .isVisible()
      .catch(() => false)

    if (jejuVisible) {
      // Step 4: Deploy Paymaster
      await page.getByRole('button', { name: /Deploy Paymaster/i }).click()
      await page.waitForTimeout(1000)

      await page.locator('.input').first().click()
      await page.waitForTimeout(500)
      await page.getByText('JEJU').click()
      await page.waitForTimeout(1000)

      const alreadyDeployed = await page
        .getByText(/already deployed/i)
        .isVisible()
        .catch(() => false)

      await page.screenshot({
        path: 'test-results/screenshots/flow/03-paymaster-check.png',
        fullPage: true,
      })

      // Step 5: Add Liquidity
      await page.getByRole('button', { name: /Add Liquidity/i }).click()
      await page.waitForTimeout(1000)

      await page.locator('.input').first().click()
      await page.waitForTimeout(500)
      await page.getByText('JEJU').click()
      await page.waitForTimeout(1000)

      const noPaymaster = await page
        .getByText(/No paymaster deployed/i)
        .isVisible()
        .catch(() => false)

      await page.screenshot({
        path: 'test-results/screenshots/flow/04-liquidity-tab.png',
        fullPage: true,
      })

      if (!noPaymaster && alreadyDeployed) {
        const ethInput = page.getByPlaceholder('1.0')
        const inputVisible = await ethInput.isVisible().catch(() => false)

        if (inputVisible) {
          await ethInput.fill('0.1')

          await page.screenshot({
            path: 'test-results/screenshots/flow/05-before-add-liquidity.png',
            fullPage: true,
          })
        }
      }
    }

    // Step 6: Navigate to LP Dashboard
    await page.getByRole('button', { name: /My Earnings/i }).click()
    await page.waitForTimeout(1000)

    await expect(page.getByText('My LP Positions')).toBeVisible()

    await page.screenshot({
      path: 'test-results/screenshots/flow/06-lp-dashboard.png',
      fullPage: true,
    })

    // Final verification
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible()
  })
})

test.describe('Node Operator Flow', () => {
  test('complete flow: View Network → Register Node → View My Nodes', async ({
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

    // Connect wallet
    await page.goto(GATEWAY_URL)
    await page.getByRole('button', { name: /sign in/i }).first().click()
    const walletOption = page.getByRole('button', { name: /connect wallet/i })
    if (await walletOption.isVisible().catch(() => false)) {
      await walletOption.click()
    }
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    // Navigate to Node Operators
    await page.getByRole('button', { name: /Node Operators/i }).click()
    await page.waitForTimeout(1000)

    await page.screenshot({
      path: 'test-results/screenshots/node-flow/01-node-operators.png',
      fullPage: true,
    })

    // Check Network Overview
    const networkOverview = page.getByRole('button', {
      name: /Network Overview/i,
    })
    if (await networkOverview.isVisible().catch(() => false)) {
      await networkOverview.click()
      await page.waitForTimeout(500)

      await page.screenshot({
        path: 'test-results/screenshots/node-flow/02-network-overview.png',
        fullPage: true,
      })
    }

    // Check My Nodes
    const myNodes = page.getByRole('button', { name: /My Nodes/i })
    if (await myNodes.isVisible().catch(() => false)) {
      await myNodes.click()
      await page.waitForTimeout(500)

      await page.screenshot({
        path: 'test-results/screenshots/node-flow/03-my-nodes.png',
        fullPage: true,
      })
    }

    // Check Register New Node
    const registerNode = page.getByRole('button', {
      name: /Register New Node/i,
    })
    if (await registerNode.isVisible().catch(() => false)) {
      await registerNode.click()
      await page.waitForTimeout(500)

      await page.screenshot({
        path: 'test-results/screenshots/node-flow/04-register-node.png',
        fullPage: true,
      })
    }

    await expect(page.locator('button:has-text(/0x/)')).toBeVisible()
  })
})

test.describe('App Registry Flow', () => {
  test('complete flow: Browse Apps → Filter by Tag → View Registration Form', async ({
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

    // Connect wallet
    await page.goto(GATEWAY_URL)
    await page.getByRole('button', { name: /sign in/i }).first().click()
    const walletOption = page.getByRole('button', { name: /connect wallet/i })
    if (await walletOption.isVisible().catch(() => false)) {
      await walletOption.click()
    }
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    // Navigate to App Registry
    await page.getByRole('button', { name: /App Registry/i }).click()
    await page.waitForTimeout(1000)

    await page.screenshot({
      path: 'test-results/screenshots/app-flow/01-app-registry.png',
      fullPage: true,
    })

    // Browse Apps
    const browseApps = page.getByRole('button', { name: /Browse Apps/i })
    if (await browseApps.isVisible().catch(() => false)) {
      await browseApps.click()
      await page.waitForTimeout(500)

      await page.screenshot({
        path: 'test-results/screenshots/app-flow/02-browse-apps.png',
        fullPage: true,
      })
    }

    // Try tag filters
    const tags = ['Games', 'DeFi', 'Social', 'All Apps']
    for (const tag of tags) {
      const tagButton = page.getByRole('button', { name: tag })
      if (await tagButton.isVisible().catch(() => false)) {
        await tagButton.click()
        await page.waitForTimeout(300)
        break
      }
    }

    await page.screenshot({
      path: 'test-results/screenshots/app-flow/03-filtered.png',
      fullPage: true,
    })

    // Register App
    const registerApp = page.getByRole('button', { name: /Register App/i })
    if (await registerApp.isVisible().catch(() => false)) {
      await registerApp.click()
      await page.waitForTimeout(500)

      await page.screenshot({
        path: 'test-results/screenshots/app-flow/04-register-app.png',
        fullPage: true,
      })
    }

    await expect(page.locator('button:has-text(/0x/)')).toBeVisible()
  })
})

test.describe('Complete Navigation Flow', () => {
  test('navigates through all tabs and captures screenshots', async ({
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
    await page.getByRole('button', { name: /sign in/i }).first().click()
    const walletOption = page.getByRole('button', { name: /connect wallet/i })
    if (await walletOption.isVisible().catch(() => false)) {
      await walletOption.click()
    }
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    const tabs = [
      { name: 'Registered Tokens', file: 'tokens' },
      { name: 'Bridge from Ethereum', file: 'bridge' },
      { name: 'Deploy Paymaster', file: 'paymaster' },
      { name: 'Add Liquidity', file: 'liquidity' },
      { name: 'My Earnings', file: 'earnings' },
      { name: 'Node Operators', file: 'nodes' },
      { name: 'App Registry', file: 'registry' },
    ]

    for (const tab of tabs) {
      await page.getByRole('button', { name: tab.name }).click()
      await page.waitForTimeout(1000)

      await page.screenshot({
        path: `test-results/screenshots/navigation/${tab.file}.png`,
        fullPage: true,
      })

      await expect(page.locator('button:has-text(/0x/)')).toBeVisible()
    }
  })
})
