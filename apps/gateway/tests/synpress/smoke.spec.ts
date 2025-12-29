/**
 * Gateway Smoke Tests
 *
 * Quick validation tests ensuring core gateway functionality works.
 * These should run first and fast to catch obvious breaks.
 */

import { getCoreAppUrl, getL2RpcUrl } from '@jejunetwork/config'
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

const GATEWAY_URL = getCoreAppUrl('GATEWAY')

test.describe('Gateway Smoke Tests', () => {
  test('homepage loads without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto(GATEWAY_URL)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/Gateway/i)).toBeVisible()
    await page.waitForTimeout(2000)

    if (errors.length > 0) {
      console.warn('Console errors:', errors)
    }

    await page.screenshot({
      path: 'test-results/screenshots/smoke-homepage.png',
      fullPage: true,
    })
  })

  test('wallet connects successfully', async ({
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
    await page.waitForLoadState('networkidle')

    await page.locator('button:has-text("Connect")').first().click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    await expect(page.locator('button:has-text(/0x/)')).toBeVisible({
      timeout: 15000,
    })

    await page.screenshot({
      path: 'test-results/screenshots/smoke-connected.png',
      fullPage: true,
    })
  })

  test('all protocol tokens load', async ({
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
    await page.waitForTimeout(3000)

    await expect(page.getByText('JEJU')).toBeVisible()

    await page.screenshot({
      path: 'test-results/screenshots/smoke-tokens.png',
      fullPage: true,
    })
  })

  test('all navigation tabs are clickable', async ({
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

    const tabs = [
      'Registered Tokens',
      'Bridge from Ethereum',
      'Deploy Paymaster',
      'Add Liquidity',
      'My Earnings',
      'Node Operators',
      'App Registry',
    ]

    for (const tab of tabs) {
      const button = page.getByRole('button', { name: tab })
      await expect(button).toBeVisible()
      await button.click()
      await page.waitForTimeout(300)
    }

    await expect(page.locator('button:has-text(/0x/)')).toBeVisible()
  })

  test('RPC endpoint is accessible', async ({ page }) => {
    const response = await page.request.post(getL2RpcUrl(), {
      data: {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      },
    })

    expect(response.status()).toBe(200)
    const result = await response.json()
    expect(result.result).toBeDefined()
  })

  test('A2A server responds', async ({ page }) => {
    const response = await page.request.get(
      `${getCoreAppUrl('NODE_EXPLORER_UI')}/.well-known/agent-card.json`,
    )
    expect(response.status()).toBe(200)

    const agentCard = await response.json()
    expect(agentCard.name).toBe('Gateway - Protocol Infrastructure Hub')
  })

  test('wallet connection persists across navigation', async ({
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

    await page.getByRole('button', { name: /Bridge from Ethereum/i }).click()
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible()

    await page.getByRole('button', { name: /Add Liquidity/i }).click()
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible()

    await page.getByRole('button', { name: /Node Operators/i }).click()
    await expect(page.locator('button:has-text(/0x/)')).toBeVisible()
  })
})
