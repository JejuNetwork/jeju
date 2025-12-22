/**
 * DWS Frontend E2E Tests - Wallet Integration
 *
 * Tests wallet connection and authenticated operations.
 * Uses Synpress for MetaMask integration.
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../../wallet-setup/basic.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const frontendUrl = process.env.BASE_URL || 'http://127.0.0.1:4033'

test.describe('DWS E2E - Wallet Connected Operations', () => {
  test('connect wallet and see dashboard', async ({
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

    await page.goto(frontendUrl)
    await expect(
      page.locator('h3:has-text("Welcome to DWS Console")'),
    ).toBeVisible()

    // Connect wallet
    await page.locator('main button:has-text("Connect Wallet")').click()
    await metamask.connectToDapp()

    // Should see dashboard with stats
    await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({
      timeout: 10000,
    })
    await expect(page.locator('.stat-card')).toHaveCount(4)
  })

  test('create and view container when connected', async ({
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

    await page.goto(frontendUrl)
    await page.locator('main button:has-text("Connect Wallet")').click()
    await metamask.connectToDapp()

    // Go to containers
    await page.click('text=Containers')
    await expect(page).toHaveURL(/\/compute\/containers/)

    // Run container button should be enabled
    const runButton = page.locator(
      '.page-header button:has-text("Run Container")',
    )
    await expect(runButton).toBeEnabled()

    // Open run container modal
    await runButton.click()
    await expect(page.locator('.modal')).toBeVisible()
    await expect(page.locator('.modal-title')).toContainText('Run Container')

    // Fill in form
    await page.fill('input[placeholder*="ubuntu"]', 'alpine:latest')
    await page.fill('input[placeholder*="python"]', 'echo "e2e test"')

    // Submit (this will create a container execution)
    await page.click('.modal button:has-text("Run")')

    // Modal should close
    await expect(page.locator('.modal')).toBeHidden({ timeout: 5000 })
  })

  test('view and add x402 credits when connected', async ({
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

    await page.goto(frontendUrl)
    await page.locator('main button:has-text("Connect Wallet")').click()
    await metamask.connectToDapp()

    // Go to billing
    await page.click('text=Billing')
    await expect(page).toHaveURL(/\/billing/)

    // Should see x402 balance
    await expect(page.locator('text=x402 Balance')).toBeVisible()

    // Add credits button should be enabled
    const addButton = page.locator('button:has-text("Add Credits")')
    await expect(addButton).toBeEnabled()

    // Open deposit modal
    await addButton.click()
    await expect(page.locator('.modal')).toBeVisible()
    await expect(page.locator('.modal-title')).toContainText('Add x402 Credits')
  })

  test('switch to provider mode and see provider dashboard', async ({
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

    await page.goto(frontendUrl)
    await page.locator('main button:has-text("Connect Wallet")').click()
    await metamask.connectToDapp()

    // Wait for dashboard
    await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({
      timeout: 10000,
    })

    // Switch to provider mode
    await page.locator('button:has-text("Provider")').click()

    // Should see provider dashboard
    await expect(page.locator('h1')).toContainText('Provider Dashboard')
    await expect(page.locator('text=Your Nodes')).toBeVisible()
    await expect(page.locator('text=Earnings')).toBeVisible()
  })

  test('upload file to storage when connected', async ({
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

    await page.goto(frontendUrl)
    await page.locator('main button:has-text("Connect Wallet")').click()
    await metamask.connectToDapp()

    // Go to storage
    await page.click('text=Buckets')
    await expect(page).toHaveURL(/\/storage\/buckets/)

    // Create bucket button should be enabled
    const createButton = page.locator('button:has-text("Create Bucket")')
    await expect(createButton).toBeEnabled()

    // Open create bucket modal
    await createButton.click()
    await expect(page.locator('.modal')).toBeVisible()
    await expect(page.locator('.modal-title')).toContainText('Create Bucket')
  })

  test('deploy worker when connected', async ({
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

    await page.goto(frontendUrl)
    await page.locator('main button:has-text("Connect Wallet")').click()
    await metamask.connectToDapp()

    // Go to workers
    await page.click('text=Workers')
    await expect(page).toHaveURL(/\/compute\/workers/)

    // Deploy button should be enabled
    const deployButton = page.locator('button:has-text("Deploy Worker")')
    await expect(deployButton).toBeEnabled()
  })

  test('view secrets when connected', async ({
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

    await page.goto(frontendUrl)
    await page.locator('main button:has-text("Connect Wallet")').click()
    await metamask.connectToDapp()

    // Go to secrets
    await page.click('text=Secrets')
    await expect(page).toHaveURL(/\/security\/secrets/)

    // Create secret button should be enabled
    const createButton = page.locator('button:has-text("Add Secret")')
    await expect(createButton).toBeEnabled()
  })

  test('view AI inference when connected', async ({
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

    await page.goto(frontendUrl)
    await page.locator('main button:has-text("Connect Wallet")').click()
    await metamask.connectToDapp()

    // Go to inference
    await page.click('text=Inference')
    await expect(page).toHaveURL(/\/ai\/inference/)

    // Should see chat interface
    await expect(page.locator('h1')).toContainText('AI Inference')
    await expect(page.locator('input[placeholder*="message"]')).toBeVisible()
  })
})
