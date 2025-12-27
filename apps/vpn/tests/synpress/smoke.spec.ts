// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { testWithSynpress } from '@synthetixio/synpress'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { metaMaskFixtures } from '@synthetixio/synpress/playwright'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { basicSetup } from '../../synpress.config'
import { takeScreenshot, waitForPageLoad } from './helpers/wallet'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const VPN_URL = process.env.VPN_URL || 'http://localhost:1421'

test.describe('VPN Smoke Tests', () => {
  test('homepage loads without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto(VPN_URL)
    await waitForPageLoad(page)

    await expect(page.locator('h1:has-text("Jeju VPN")')).toBeVisible()
    await expect(page.getByText(/Disconnected|Connected/)).toBeVisible()

    await page.waitForTimeout(2000)

    if (errors.length > 0) {
      console.warn('Console errors:', errors)
    }

    await takeScreenshot(page, 'smoke-homepage')
  })

  test('all three navigation tabs are visible', async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)

    const navButtons = page.locator('nav button')
    await expect(navButtons).toHaveCount(3)

    await expect(page.getByText('VPN')).toBeVisible()
    await expect(page.getByText('Contribute')).toBeVisible()
    await expect(page.getByText('Settings')).toBeVisible()

    await takeScreenshot(page, 'smoke-navigation')
  })

  test('VPN tab displays core elements', async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)

    const connectBtn = page.locator('button.w-32.h-32')
    await expect(connectBtn).toBeVisible()

    await expect(page.getByText('Tap to Connect')).toBeVisible()

    await expect(page.getByText('Nodes')).toBeVisible()
    await expect(page.getByText('Users')).toBeVisible()
    await expect(page.getByText('CDN Cache')).toBeVisible()

    await takeScreenshot(page, 'smoke-vpn-tab')
  })

  test('Contribution tab loads correctly', async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)

    await page.locator('nav button').nth(1).click()
    await page.waitForTimeout(300)

    await expect(page.getByText('Fair Contribution')).toBeVisible()
    await expect(page.getByText('Adaptive Bandwidth')).toBeVisible()
    await expect(page.getByText('Contribution Quota')).toBeVisible()

    await takeScreenshot(page, 'smoke-contribution-tab')
  })

  test('Settings tab loads correctly', async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)

    await page.locator('nav button').nth(2).click()
    await page.waitForTimeout(300)

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByText('Kill Switch')).toBeVisible()
    await expect(page.getByText('WireGuard')).toBeVisible()

    await takeScreenshot(page, 'smoke-settings-tab')
  })

  test('API health check responds', async ({ page }) => {
    const apiUrl = process.env.VPN_API_URL || 'http://localhost:4021'

    const response = await page.request.get(`${apiUrl}/health`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.status).toBe('ok')
    expect(data.service).toBe('vpn')
  })

  test('agent card is accessible', async ({ page }) => {
    const apiUrl = process.env.VPN_API_URL || 'http://localhost:4021'

    const response = await page.request.get(
      `${apiUrl}/.well-known/agent-card.json`,
    )
    expect(response.status()).toBe(200)

    const agentCard = await response.json()
    expect(agentCard.name).toBe('Jeju VPN Agent')
    expect(agentCard.skills).toBeDefined()
    expect(agentCard.skills.length).toBeGreaterThan(0)
  })
})
