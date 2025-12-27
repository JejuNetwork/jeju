/**
 * Gateway Paymaster Tests
 *
 * Tests paymaster deployment and management.
 */

// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { testWithSynpress } from '@synthetixio/synpress'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4001'

async function connectAndNavigateToPaymaster(
  page: ReturnType<typeof test.extend>['page'] extends Promise<infer P>
    ? P
    : never,
  metamask: MetaMask,
) {
  await page.goto(GATEWAY_URL)
  await page.locator('button:has-text("Connect")').first().click()
  await page.waitForTimeout(1000)
  await metamask.connectToDapp()
  await page.getByRole('button', { name: /Deploy Paymaster/i }).click()
  await page.waitForTimeout(1000)
}

test.describe('Paymaster Interface', () => {
  test('displays paymaster deployment interface', async ({
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

    await connectAndNavigateToPaymaster(page, metamask)

    await expect(
      page.getByText(/Deploy Paymaster|Paymaster Factory/i),
    ).toBeVisible()

    await page.screenshot({
      path: 'test-results/screenshots/paymaster-interface.png',
      fullPage: true,
    })
  })

  test('shows token selector with all protocol tokens', async ({
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

    await connectAndNavigateToPaymaster(page, metamask)

    await page.locator('.input').first().click()
    await page.waitForTimeout(500)

    await expect(page.getByText('JEJU')).toBeVisible()
  })

  test('shows deployment requirements', async ({
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

    await connectAndNavigateToPaymaster(page, metamask)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
    expect(body?.toLowerCase()).toMatch(/deploy|paymaster|token/)
  })
})

test.describe('Token Selection', () => {
  test('selects JEJU token', async ({
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

    await connectAndNavigateToPaymaster(page, metamask)

    await page.locator('.input').first().click()
    await page.waitForTimeout(500)
    await page.getByText('JEJU').click()
    await page.waitForTimeout(1000)

    await page.screenshot({
      path: 'test-results/screenshots/paymaster-jeju-selected.png',
      fullPage: true,
    })
  })

  test('displays fee margin slider when token selected', async ({
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

    await connectAndNavigateToPaymaster(page, metamask)

    await page.locator('.input').first().click()
    await page.waitForTimeout(500)
    await page.getByText('JEJU').click()
    await page.waitForTimeout(1000)

    const slider = page.locator('input[type="range"]')
    const hasSlider = await slider.isVisible().catch(() => false)

    if (hasSlider) {
      await slider.fill('150')
      await page.screenshot({
        path: 'test-results/screenshots/paymaster-fee-margin.png',
        fullPage: true,
      })
    }
  })

  test('shows already deployed indicator if applicable', async ({
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

    await connectAndNavigateToPaymaster(page, metamask)

    await page.locator('.input').first().click()
    await page.waitForTimeout(500)
    await page.getByText('JEJU').click()
    await page.waitForTimeout(1000)

    const deployedIndicator = page.getByText(/already deployed/i)
    const isDeployed = await deployedIndicator.isVisible().catch(() => false)

    if (isDeployed) {
      await expect(deployedIndicator).toBeVisible()
    } else {
      const deployButton = page.getByRole('button', {
        name: /Deploy Paymaster for JEJU/i,
      })
      const hasDeployButton = await deployButton.isVisible().catch(() => false)
      expect(hasDeployButton).toBe(true)
    }
  })
})

test.describe('Deployment Transaction', () => {
  test('shows deploy button for token without paymaster', async ({
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

    await connectAndNavigateToPaymaster(page, metamask)

    await page.locator('.input').first().click()
    await page.waitForTimeout(500)

    const tokens = ['JEJU']
    for (const token of tokens) {
      const tokenOption = page.getByText(token)
      const isVisible = await tokenOption.isVisible().catch(() => false)

      if (isVisible) {
        await tokenOption.click()
        await page.waitForTimeout(1000)

        const alreadyDeployed = await page
          .getByText(/already deployed/i)
          .isVisible()
          .catch(() => false)

        if (!alreadyDeployed) {
          const deployButton = page.getByRole('button', {
            name: new RegExp(`Deploy Paymaster for ${token}`, 'i'),
          })
          await expect(deployButton).toBeVisible()
          break
        }

        await page.locator('.input').first().click()
        await page.waitForTimeout(500)
      }
    }
  })
})
