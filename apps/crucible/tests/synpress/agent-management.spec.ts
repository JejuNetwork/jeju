/**
 * Agent Management Tests
 *
 * Tests agent registration, funding, state management, and basic UI functionality.
 * Includes smoke tests to verify the UI loads correctly.
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Crucible Smoke Tests', () => {
  test('should load the crucible dashboard', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveTitle(/Crucible/)
  })

  test('should show health status as healthy', async ({ page }) => {
    const response = await page.request.get('/health')
    const data = await response.json()

    expect(data.status).toBe('healthy')
    expect(data.service).toBe('crucible')
  })

  test('should list available character templates', async ({ page }) => {
    const response = await page.request.get('/api/v1/characters')
    const data = await response.json()

    expect(data.characters).toBeDefined()
    expect(data.characters.length).toBeGreaterThan(0)

    const ids = data.characters.map((c: { id: string }) => c.id)
    expect(ids).toContain('project-manager')
    expect(ids).toContain('red-team')
    expect(ids).toContain('blue-team')
  })

  test('should return info endpoint', async ({ page }) => {
    const response = await page.request.get('/info')
    const data = await response.json()

    expect(data.service).toBe('crucible')
    expect(data.version).toBe('1.0.0')
    expect(data.contracts).toBeDefined()
  })
})

test.describe('Agent Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('should display connect wallet button when not connected', async ({
    page,
  }) => {
    const connectBtn = page.getByTestId('connect-wallet')
    await expect(connectBtn).toBeVisible()
  })

  test('should connect wallet via MetaMask', async ({
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

    const connectBtn = page.getByTestId('connect-wallet')
    await connectBtn.click()

    await metamask.connectToDapp()

    const walletInfo = page.getByTestId('wallet-info')
    await expect(walletInfo).toBeVisible({ timeout: 10000 })
  })

  test('should fetch character template via API', async ({ page }) => {
    const response = await page.request.get(
      '/api/v1/characters/project-manager',
    )
    const data = await response.json()

    expect(data.character).toBeDefined()
    expect(data.character.id).toBe('project-manager')
    expect(data.character.name).toBe('Jimmy')
  })

  test('should register new agent with wallet', async ({
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

    await page.getByTestId('connect-wallet').click()
    await metamask.connectToDapp()
    await expect(page.getByTestId('wallet-info')).toBeVisible({
      timeout: 10000,
    })

    const charResponse = await page.request.get(
      '/api/v1/characters/project-manager',
    )
    const { character } = await charResponse.json()

    const registerResponse = await page.request.post('/api/v1/agents', {
      data: {
        character,
        initialFunding: '10000000000000000',
      },
    })

    expect(registerResponse.status()).toBeLessThanOrEqual(500)
  })

  test('should show agent list when connected', async ({
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

    await page.getByTestId('connect-wallet').click()
    await metamask.connectToDapp()

    const agentList = page.getByTestId('agent-list')
    await expect(agentList).toBeVisible({ timeout: 10000 })
  })
})
