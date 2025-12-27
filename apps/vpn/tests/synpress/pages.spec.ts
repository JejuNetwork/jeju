// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { testWithSynpress } from '@synthetixio/synpress'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { metaMaskFixtures } from '@synthetixio/synpress/playwright'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { basicSetup } from '../../synpress.config'
import {
  navigateToTab,
  takeScreenshot,
  waitForPageLoad,
} from './helpers/wallet'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const VPN_URL = process.env.VPN_URL || 'http://localhost:1421'

test.describe('VPN Tab - All Elements', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)
  })

  test('header displays correctly', async ({ page }) => {
    await expect(page.locator('h1:has-text("Jeju VPN")')).toBeVisible()
    await expect(page.getByText('Decentralized Privacy')).toBeVisible()

    await expect(
      page.getByText(/Disconnected|Connected|Connecting/),
    ).toBeVisible()
  })

  test('connect button is interactive', async ({ page }) => {
    const connectBtn = page.locator('button.w-32.h-32')
    await expect(connectBtn).toBeVisible()
    await expect(connectBtn).toBeEnabled()

    const powerIcon = connectBtn.locator('svg')
    await expect(powerIcon).toBeVisible()
  })

  test('region selector displays', async ({ page }) => {
    const regionCard = page.locator('.card-hover').first()
    await expect(regionCard).toBeVisible()

    await expect(regionCard.locator('span').first()).toBeVisible()

    await expect(regionCard.locator('svg')).toBeVisible()
  })

  test('quick stats cards display', async ({ page }) => {
    await expect(page.getByText('Nodes')).toBeVisible()
    await expect(page.getByText('Users')).toBeVisible()
    await expect(page.getByText('CDN Cache')).toBeVisible()

    const statsCards = page.locator('.card.text-center')
    const count = await statsCards.count()
    expect(count).toBe(3)

    await takeScreenshot(page, 'page-vpn-stats')
  })

  test('region dropdown opens and shows countries', async ({ page }) => {
    const regionSelector = page.locator('.card-hover').first()
    await regionSelector.click()

    await expect(page.getByText('Fastest Server')).toBeVisible()

    await page.locator('.fixed.inset-0').click()

    await takeScreenshot(page, 'page-vpn-dropdown')
  })
})

test.describe('Contribution Tab - All Elements', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)
    await navigateToTab(page, 1)
  })

  test('header and description display', async ({ page }) => {
    await expect(page.getByText('Fair Contribution')).toBeVisible()
    await expect(
      page.getByText('Help power the network and earn tokens'),
    ).toBeVisible()
  })

  test('adaptive bandwidth card displays', async ({ page }) => {
    await expect(page.getByText('Adaptive Bandwidth')).toBeVisible()

    await expect(
      page.getByText(/Idle - Max Sharing|Active - Min Sharing/),
    ).toBeVisible()

    await expect(page.getByText('Sharing Now')).toBeVisible()
    await expect(page.getByText('Mbps')).toBeVisible()
    await expect(page.getByText('Min Idle')).toBeVisible()
  })

  test('contribution quota displays', async ({ page }) => {
    await expect(page.getByText('Contribution Quota')).toBeVisible()
    await expect(page.getByText(/of 3x limit/)).toBeVisible()

    const progressBar = page.locator('.h-3.bg-\\[\\#1a1a25\\]')
    await expect(progressBar).toBeVisible()

    await expect(page.getByText(/Contributed:/)).toBeVisible()
    await expect(page.getByText(/Cap:/)).toBeVisible()
  })

  test('edge CDN cache card displays', async ({ page }) => {
    await expect(page.getByText('Edge CDN Cache')).toBeVisible()
    await expect(page.getByText(/Active|Inactive/)).toBeVisible()

    await expect(page.getByText('Cache Size')).toBeVisible()
    await expect(page.getByText('Cached Items')).toBeVisible()
    await expect(page.getByText('Requests Served')).toBeVisible()
    await expect(page.getByText('CDN Earnings')).toBeVisible()
  })

  test('contribution stats grid displays', async ({ page }) => {
    await expect(page.getByText('CDN Served')).toBeVisible()
    await expect(page.getByText('VPN Relayed')).toBeVisible()
    await expect(page.getByText('Users Helped')).toBeVisible()
    await expect(page.getByText('JEJU Earned')).toBeVisible()

    await takeScreenshot(page, 'page-contribution-stats')
  })

  test('settings section displays', async ({ page }) => {
    await expect(page.getByText('Auto Contribution')).toBeVisible()
    await expect(page.getByText('Share 10% bandwidth when idle')).toBeVisible()

    await expect(page.getByText('Earning Mode')).toBeVisible()
    await expect(
      page.getByText('Share 50% bandwidth, earn more tokens'),
    ).toBeVisible()
  })

  test('fair sharing explanation displays', async ({ page }) => {
    await expect(page.getByText('How Fair Sharing Works')).toBeVisible()
    await expect(page.getByText(/You get free, unlimited VPN/)).toBeVisible()

    await takeScreenshot(page, 'page-contribution-complete')
  })
})

test.describe('Settings Tab - All Elements', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)
    await navigateToTab(page, 2)
  })

  test('header and description display', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByText('Configure your VPN experience')).toBeVisible()
  })

  test('connection settings display', async ({ page }) => {
    await expect(page.getByText('Connection').first()).toBeVisible()

    // Kill Switch
    await expect(page.getByText('Kill Switch')).toBeVisible()
    await expect(
      page.getByText('Block internet if VPN disconnects'),
    ).toBeVisible()

    // Auto Connect
    await expect(page.getByText('Auto Connect')).toBeVisible()
    await expect(page.getByText('Connect when app starts')).toBeVisible()
  })

  test('startup settings display', async ({ page }) => {
    await expect(page.getByText('Startup')).toBeVisible()

    await expect(page.getByText('Start on Boot')).toBeVisible()
    await expect(page.getByText('Launch VPN when system starts')).toBeVisible()

    await expect(page.getByText('Minimize to Tray')).toBeVisible()
    await expect(page.getByText('Keep running in system tray')).toBeVisible()
  })

  test('protocol options display', async ({ page }) => {
    await expect(page.getByText('Protocol')).toBeVisible()

    await expect(page.getByText('WireGuard')).toBeVisible()
    await expect(page.getByText('Recommended')).toBeVisible()

    await expect(page.getByText('SOCKS5 Proxy')).toBeVisible()
    await expect(page.getByText('Browser only')).toBeVisible()
  })

  test('bandwidth management displays', async ({ page }) => {
    await expect(page.getByText('Bandwidth Management')).toBeVisible()

    await expect(page.getByText('Adaptive Bandwidth')).toBeVisible()
    await expect(
      page.getByText('Share more when idle (up to 80%)'),
    ).toBeVisible()

    await expect(page.getByText('Edge CDN Caching')).toBeVisible()
    await expect(page.getByText('Cache and serve DWS content')).toBeVisible()
  })

  test('DNS options display', async ({ page }) => {
    await expect(page.getByText('DNS Servers')).toBeVisible()

    await expect(page.getByText('Cloudflare (1.1.1.1)')).toBeVisible()
    await expect(page.getByText('Google (8.8.8.8)')).toBeVisible()
    await expect(page.getByText('Custom')).toBeVisible()
  })

  test('about section displays', async ({ page }) => {
    await expect(page.getByText('About')).toBeVisible()

    await expect(page.getByText('Version')).toBeVisible()
    await expect(page.getByText('0.1.0')).toBeVisible()

    await expect(page.getByText('Network')).toBeVisible()
    await expect(page.getByText('Jeju Mainnet')).toBeVisible()

    await expect(page.getByText('Learn More')).toBeVisible()

    await takeScreenshot(page, 'page-settings-complete')
  })
})
