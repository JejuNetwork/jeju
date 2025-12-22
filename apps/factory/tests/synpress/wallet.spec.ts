/**
 * Wallet E2E Tests (Synpress)
 * Tests wallet connection, transactions, and on-chain operations
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Wallet Connection', () => {
  test('shows connect wallet button when disconnected', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('button', { name: /connect wallet/i }),
    ).toBeVisible()
  })

  test('connects wallet via MetaMask', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()
    await expect(page.getByText(/0x[a-f0-9]{4,}/i).first()).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows user menu when connected', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()
    await expect(
      page.locator('button').filter({ has: page.locator('img.rounded-full') }),
    ).toBeVisible()
  })

  test('disconnects wallet', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page
      .locator('button')
      .filter({ has: page.locator('img.rounded-full') })
      .click()

    await page.getByRole('button', { name: /disconnect/i }).click()

    await expect(
      page.getByRole('button', { name: /connect wallet/i }),
    ).toBeVisible()
  })
})

test.describe('Bounty Transactions', () => {
  test('creates bounty with on-chain transaction', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/bounties/new')
    await page.getByLabel(/title/i).fill('E2E Test Bounty')
    await page
      .getByLabel(/description/i)
      .fill('This is a test bounty created by E2E tests')
    await page.getByLabel(/reward/i).fill('0.01')

    await page.getByRole('button', { name: /create bounty/i }).click()
    await metamask.confirmTransaction()

    await expect(page).toHaveURL(/\/bounties\/\d+/, { timeout: 30000 })
    await expect(page.getByText('E2E Test Bounty')).toBeVisible()
  })

  test('applies to bounty', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/bounties/1')
    await page.getByRole('button', { name: /apply/i }).click()
    await page
      .getByLabel(/proposal/i)
      .fill('I can complete this bounty within the deadline')

    await page.getByRole('button', { name: /submit application/i }).click()
    await metamask.confirmTransaction()

    await expect(page.getByText(/application submitted/i)).toBeVisible({
      timeout: 30000,
    })
  })

  test('submits bounty work', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/bounties/1')
    await page.getByRole('button', { name: /submit work/i }).click()
    await page
      .getByLabel(/submission url/i)
      .fill('https://github.com/jeju/test-submission')
    await page
      .getByLabel(/description/i)
      .fill('Work completed as per requirements')

    await page.getByRole('button', { name: /submit/i }).click()
    await metamask.confirmTransaction()

    await expect(page.getByText(/pending review/i)).toBeVisible({
      timeout: 30000,
    })
  })
})

test.describe('Guardian Actions', () => {
  test('registers as guardian', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/guardians')
    await page.getByRole('button', { name: /register as guardian/i }).click()

    await page.getByLabel(/stake amount/i).fill('0.1')
    await page.getByLabel(/specializations/i).fill('smart contracts, security')

    await page.getByRole('button', { name: /stake and register/i }).click()
    await metamask.confirmTransaction()

    await expect(page.getByText(/guardian registered/i)).toBeVisible({
      timeout: 30000,
    })
  })

  test('reviews and approves submission', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/bounties/1')
    await page.getByRole('button', { name: /review submission/i }).click()
    await page.getByRole('button', { name: /approve/i }).click()

    await metamask.confirmTransaction()

    await expect(page.getByText(/approved/i)).toBeVisible({ timeout: 30000 })
  })
})

test.describe('Model Registration', () => {
  test('registers model on-chain', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/models/upload')
    await page.getByLabel(/name/i).fill('test-model')
    await page.getByLabel(/model type/i).selectOption('llm')
    await page.getByLabel(/description/i).fill('Test model for E2E')

    await page.getByRole('button', { name: /register model/i }).click()
    await metamask.confirmTransaction()

    await expect(page).toHaveURL(/\/models\/\w+\/test-model/, {
      timeout: 30000,
    })
  })
})

test.describe('Container Registration', () => {
  test('registers container on-chain', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/containers/push')
    await page.getByLabel(/name/i).fill('test-container')
    await page.getByLabel(/tag/i).fill('latest')
    await page.getByLabel(/architectures/i).check()

    await page.getByRole('button', { name: /register container/i }).click()
    await metamask.confirmTransaction()

    await expect(page).toHaveURL(/\/containers\/\w+\/test-container/, {
      timeout: 30000,
    })
  })
})

test.describe('Project Board Transactions', () => {
  test('creates project on-chain', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/projects/new')
    await page.getByLabel(/name/i).fill('E2E Test Project')
    await page.getByLabel(/description/i).fill('Test project for E2E')

    await page.getByRole('button', { name: /create project/i }).click()
    await metamask.confirmTransaction()

    await expect(page).toHaveURL(/\/projects\/\d+/, { timeout: 30000 })
  })

  test('adds task to project', async ({
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

    await page.goto('/')
    await page.getByRole('button', { name: /connect wallet/i }).click()

    const metamaskOption = page.getByText(/metamask/i)
    if (await metamaskOption.isVisible()) {
      await metamaskOption.click()
    }

    await metamask.connectToDapp()

    await page.goto('/projects/1')
    await page.getByRole('button', { name: /add task/i }).click()

    await page.getByLabel(/title/i).fill('E2E Test Task')
    await page.getByLabel(/description/i).fill('Test task created by E2E')

    await page.getByRole('button', { name: /create task/i }).click()
    await metamask.confirmTransaction()

    await expect(page.getByText('E2E Test Task')).toBeVisible({
      timeout: 30000,
    })
  })
})
