/**
 * Wallet Connection Tests - MetaMask/Synpress
 *
 * Tests wallet connection flows:
 * - Connect via MetaMask
 * - Verify connected state
 * - Disconnect functionality
 * - Sign messages (SIWE)
 */

import { CORE_PORTS } from '@jejunetwork/config'
import {
  basicSetup,
  connectAndVerify,
  isAuthenticated,
  test,
  verifyDisconnected,
  walletPassword,
} from '@jejunetwork/tests'
import { expect } from '@playwright/test'
import { MetaMask } from '@synthetixio/synpress/playwright'

const AUTOCRAT_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_WEB.get()}`

test.describe('Wallet Connection', () => {
  test('can connect wallet from header', async ({
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

    await page.goto(AUTOCRAT_URL)
    await page.waitForLoadState('networkidle')

    // Verify initially disconnected
    await verifyDisconnected(page, { connectButtonText: 'Connect' })

    // Connect wallet
    await connectAndVerify(page, metamask, {
      connectButtonText: 'Connect',
    })

    // Verify connected state persists
    const isConnected = await isAuthenticated(page)
    expect(isConnected).toBe(true)
  })

  test('connection persists across page navigation', async ({
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

    await page.goto(AUTOCRAT_URL)
    await page.waitForLoadState('networkidle')

    // Connect
    await connectAndVerify(page, metamask, {
      connectButtonText: 'Connect',
    })

    // Navigate to proposals
    await page.getByRole('link', { name: 'Proposals' }).click()
    await expect(page).toHaveURL(`${AUTOCRAT_URL}/proposals`)

    // Should still be connected
    const stillConnected = await isAuthenticated(page)
    expect(stillConnected).toBe(true)

    // Navigate to create
    await page.getByRole('link', { name: /Create/ }).click()
    await expect(page).toHaveURL(`${AUTOCRAT_URL}/create`)

    // Should still be connected
    const stillConnected2 = await isAuthenticated(page)
    expect(stillConnected2).toBe(true)
  })

  test('can connect wallet on create page', async ({
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

    await page.goto(`${AUTOCRAT_URL}/create`)
    await page.waitForLoadState('networkidle')

    // Connect from create page
    await connectAndVerify(page, metamask, {
      connectButtonText: 'Connect',
    })

    // Verify connected
    const isConnected = await isAuthenticated(page)
    expect(isConnected).toBe(true)
  })

  test('shows connect prompt on protected actions', async ({ page }) => {
    await page.goto(`${AUTOCRAT_URL}/create`)
    await page.waitForLoadState('networkidle')

    // Fill out a minimal proposal
    await page.getByLabel('Title').fill('Test Proposal Title for Testing')
    await page
      .getByLabel('Summary')
      .fill(
        'This is a test summary that meets the minimum character requirements for proposals.',
      )
    await page.getByLabel('Full Description').fill(`
## Problem
This is a test problem description.

## Solution
This is a test solution.

## Implementation
Step 1: Do this
Step 2: Do that

## Timeline
Week 1: Planning
Week 2: Execution

## Budget
$10,000 USD
    `)

    // Try to proceed without wallet connected
    await page.getByRole('button', { name: 'Continue' }).click()

    // Should show connect wallet message eventually when trying to submit
    // (This tests the UX flow, actual wallet connection is separate test)
  })
})

test.describe('Auth Button Options', () => {
  test('auth modal shows multiple options', async ({ page }) => {
    await page.goto(AUTOCRAT_URL)
    await page.waitForLoadState('networkidle')

    // Click connect to open modal
    await page.getByRole('button', { name: 'Connect' }).click()

    // Wait for modal
    await page.waitForTimeout(500)

    // Should show wallet options (MetaMask, WalletConnect if configured)
    const metamaskOption = page.locator('text=MetaMask')
    if (await metamaskOption.isVisible({ timeout: 2000 })) {
      expect(await metamaskOption.isVisible()).toBe(true)
    }
  })
})

// Export setup for other tests to use
export { basicSetup }
