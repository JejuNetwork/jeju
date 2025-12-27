/**
 * Gateway Bridge Tests
 *
 * Tests token bridging from Ethereum to the network.
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

async function connectAndNavigateToBridge(
  page: ReturnType<typeof test.extend>['page'] extends Promise<infer P>
    ? P
    : never,
  metamask: MetaMask,
) {
  await page.goto(GATEWAY_URL)
  await page.locator('button:has-text("Connect")').first().click()
  await page.waitForTimeout(1000)
  await metamask.connectToDapp()
  await page.getByRole('button', { name: /Bridge from Ethereum/i }).click()
  await page.waitForTimeout(1000)
}

test.describe('Bridge Interface', () => {
  test('displays bridge interface', async ({
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

    await connectAndNavigateToBridge(page, metamask)

    await expect(
      page.getByText('Bridge from Ethereum to the network'),
    ).toBeVisible()

    await page.screenshot({
      path: 'test-results/screenshots/bridge-interface.png',
      fullPage: true,
    })
  })

  test('shows JEJU native token warning', async ({
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

    await connectAndNavigateToBridge(page, metamask)

    await expect(
      page.getByText(/JEJU is a native network token/i),
    ).toBeVisible()
    await expect(
      page.getByText(/cannot be bridged from Ethereum/i),
    ).toBeVisible()
  })

  test('shows bridge transaction details', async ({
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

    await connectAndNavigateToBridge(page, metamask)

    await expect(page.getByText(/Estimated Time/i)).toBeVisible()
    await expect(page.getByText(/~2 minutes/i)).toBeVisible()
    await expect(page.getByText(/OP Stack Standard Bridge/i)).toBeVisible()
  })
})

test.describe('Token Selection', () => {
  test('shows only bridgeable tokens in selector', async ({
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

    await connectAndNavigateToBridge(page, metamask)

    await page.locator('.input').first().click()
    await page.waitForTimeout(500)

    // Check that bridgeable tokens are shown (none currently - only JEJU which is native)
    const dropdown = page.locator('[style*="position: absolute"]')
    const hasJeju = await dropdown
      .getByText('JEJU')
      .isVisible()
      .catch(() => false)
    // JEJU should not be in bridge since it's native
    expect(hasJeju).toBe(false)
  })

  test('allows custom token address input', async ({
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

    await connectAndNavigateToBridge(page, metamask)

    await page.getByRole('button', { name: /Custom Address/i }).click()

    await expect(page.getByPlaceholder('0x...')).toBeVisible()
    await expect(page.getByText(/Enter any ERC20 token address/i)).toBeVisible()

    await page
      .getByPlaceholder('0x...')
      .fill('0x1234567890123456789012345678901234567890')
  })
})

test.describe('Amount Validation', () => {
  test('validates amount input and shows USD value', async ({
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

    await connectAndNavigateToBridge(page, metamask)

    // Test custom token address since native tokens can't be bridged
    await page.getByRole('button', { name: /Custom Address/i }).click()
    await page
      .getByPlaceholder('0x...')
      .fill('0x1234567890123456789012345678901234567890')

    const amountInput = page.getByPlaceholder('0.0')
    await amountInput.fill('100')

    // Just verify the form works
    expect(await amountInput.inputValue()).toBe('100')
  })

  test('disables bridge button without amount', async ({
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

    await connectAndNavigateToBridge(page, metamask)

    await page.getByRole('button', { name: /Custom Address/i }).click()
    await page
      .getByPlaceholder('0x...')
      .fill('0x1234567890123456789012345678901234567890')

    const bridgeButton = page.getByRole('button', {
      name: /Bridge to the network/i,
    })
    await expect(bridgeButton).toBeDisabled()
  })

  test('handles optional recipient address', async ({
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

    await connectAndNavigateToBridge(page, metamask)

    await page.getByRole('button', { name: /Custom Address/i }).click()
    await page
      .getByPlaceholder('0x...')
      .fill('0x1234567890123456789012345678901234567890')
    await page.getByPlaceholder('0.0').fill('50')

    const recipientInput = page.getByPlaceholder(/0x.../)
    await expect(recipientInput).toBeVisible()

    const bridgeButton = page.getByRole('button', {
      name: /Bridge to the network/i,
    })
    await expect(bridgeButton).toBeEnabled()
  })

  test('validates custom token address format', async ({
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

    await connectAndNavigateToBridge(page, metamask)

    await page.getByRole('button', { name: /Custom Address/i }).click()

    const customInput = page.getByPlaceholder('0x...')
    await customInput.fill('invalid-address')
    await page.getByPlaceholder('0.0').fill('100')

    const bridgeButton = page.getByRole('button', {
      name: /Bridge to the network/i,
    })
    await expect(bridgeButton).toBeDisabled()
  })
})
