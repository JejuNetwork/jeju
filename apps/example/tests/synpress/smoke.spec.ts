/**
 * Example App E2E Smoke Tests
 *
 * Tests core functionality against real localnet:
 * - App loads correctly
 * - Wallet connection works
 * - Basic API endpoints respond
 * - Database operations work
 */

import {
  approveTransaction,
  connectAndVerify,
  expect,
  test,
  walletPassword,
} from '@jejunetwork/tests'
import { MetaMask } from '@synthetixio/synpress/playwright'

test.describe('Example App Smoke Tests', () => {
  test('should load homepage', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Example|Jeju/i)
  })

  test('should connect wallet', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      walletPassword,
      extensionId,
    )

    await page.goto('/')
    await connectAndVerify(page, metamask)

    // Verify connected state
    await expect(page.getByText(/0x/)).toBeVisible()
  })

  test('should check health endpoint', async ({ page }) => {
    const response = await page.request.get('/health')
    expect(response.ok()).toBe(true)
  })

  test('should access A2A endpoint', async ({ page }) => {
    const response = await page.request.get('/.well-known/agent-card.json')
    expect(response.ok()).toBe(true)

    const card = await response.json()
    expect(card).toHaveProperty('name')
    expect(card).toHaveProperty('a2a_endpoint')
  })
})

test.describe('Database Operations', () => {
  test('should create and read data', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      walletPassword,
      extensionId,
    )

    await page.goto('/')
    await connectAndVerify(page, metamask)

    // Test data creation flow
    // TODO: Add specific form interactions based on app UI
    await page.click('button:has-text(/create|new|add/i)')

    // Fill form if visible
    const formVisible = await page.locator('form').isVisible({ timeout: 2000 })
    if (formVisible) {
      await page.fill('input[name="title"]', 'Test Item')
      await page.fill('textarea[name="description"]', 'Test Description')
      await page.click('button[type="submit"]')
    }

    // Verify creation
    await expect(page.getByText('Test Item')).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Wallet Transactions', () => {
  test('should sign message', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      walletPassword,
      extensionId,
    )

    await page.goto('/')
    await connectAndVerify(page, metamask)

    // Trigger sign action
    const signButton = page.locator('button:has-text(/sign/i)')
    if (await signButton.isVisible({ timeout: 2000 })) {
      await signButton.click()
      await metamask.confirmSignature()
    }
  })

  test('should handle transaction', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      walletPassword,
      extensionId,
    )

    await page.goto('/')
    await connectAndVerify(page, metamask)

    // Find and click transaction button
    const txButton = page.locator(
      'button:has-text(/send|submit|confirm|mint/i)',
    )
    if (await txButton.isVisible({ timeout: 2000 })) {
      await txButton.click()
      await approveTransaction(metamask)

      // Wait for transaction confirmation
      await expect(page.getByText(/success|confirmed|complete/i)).toBeVisible({
        timeout: 30000,
      })
    }
  })
})
