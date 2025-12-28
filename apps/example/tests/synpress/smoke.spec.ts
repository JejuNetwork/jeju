import {
  approveTransaction,
  connectAndVerify,
  expect,
  test,
  walletPassword,
} from '@jejunetwork/tests'
import { MetaMask } from '@synthetixio/synpress/playwright'

test.describe('Smoke Tests', () => {
  test('should load homepage', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Jeju Tasks/i)
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

    await expect(page.getByText(/0x/)).toBeVisible()
  })

  test('should check health endpoint', async ({ page }) => {
    const response = await page.request.get('/health')
    expect(response.ok()).toBe(true)
  })

  test('should access A2A agent card', async ({ page }) => {
    const response = await page.request.get('/a2a/.well-known/agent-card.json')
    expect(response.ok()).toBe(true)

    const card = await response.json()
    expect(card).toHaveProperty('name')
    expect(card).toHaveProperty('skills')
  })
})

test.describe('Todo Operations', () => {
  test('should create todo after wallet connection', async ({
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

    await page.locator('#todo-input').fill('Test Task')
    await page.locator('#priority-select').selectOption('high')
    await page.locator('button[type="submit"]').click()

    await page.waitForTimeout(500)
    await metamask.confirmSignature()

    await expect(page.getByText('Test Task')).toBeVisible({ timeout: 15000 })
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

    await page.locator('#todo-input').fill('Sign Test')
    await page.locator('button[type="submit"]').click()

    await page.waitForTimeout(500)
    await metamask.confirmSignature()

    await expect(page.getByText('Sign Test')).toBeVisible({ timeout: 15000 })
  })
})
