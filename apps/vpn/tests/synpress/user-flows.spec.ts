import { testWithSynpress } from '@synthetixio/synpress'
import { metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'
import {
  getCurrentTab,
  navigateToTab,
  takeScreenshot,
  waitForPageLoad,
} from './helpers/wallet'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const VPN_URL = process.env.VPN_URL || 'http://localhost:1421'

test.describe('Navigation Flow', () => {
  test('complete navigation cycle through all tabs', async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)

    let currentTab = await getCurrentTab(page)
    expect(currentTab).toBe('vpn')

    await navigateToTab(page, 1)
    currentTab = await getCurrentTab(page)
    expect(currentTab).toBe('contribution')
    await takeScreenshot(page, 'flow-nav-contribution')

    await navigateToTab(page, 2)
    currentTab = await getCurrentTab(page)
    expect(currentTab).toBe('settings')
    await takeScreenshot(page, 'flow-nav-settings')

    await navigateToTab(page, 0)
    currentTab = await getCurrentTab(page)
    expect(currentTab).toBe('vpn')
    await takeScreenshot(page, 'flow-nav-vpn')
  })

  test('tab state persists correctly', async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)

    await navigateToTab(page, 2)
    await navigateToTab(page, 0)

    await expect(page.getByText('Tap to Connect')).toBeVisible()
  })
})

test.describe('VPN Connection Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)
  })

  test('connect button changes state on click', async ({ page }) => {
    const connectBtn = page.locator('button.w-32.h-32')

    await expect(page.getByText('Tap to Connect')).toBeVisible()
    await expect(page.getByText('Disconnected')).toBeVisible()

    await connectBtn.click()

    await expect(page.getByText(/Connecting|Protected/)).toBeVisible({
      timeout: 5000,
    })

    await takeScreenshot(page, 'flow-vpn-connecting')
  })

  test('connect and disconnect cycle', async ({ page }) => {
    const connectBtn = page.locator('button.w-32.h-32')

    await connectBtn.click()
    await expect(page.getByText('Protected')).toBeVisible({ timeout: 5000 })
    await takeScreenshot(page, 'flow-vpn-connected')

    await expect(page.getByText('Connection')).toBeVisible()
    await expect(page.getByText('Active')).toBeVisible()

    await connectBtn.click()
    await expect(page.getByText('Tap to Connect')).toBeVisible({
      timeout: 5000,
    })
    await takeScreenshot(page, 'flow-vpn-disconnected')
  })

  test('connection stats update when connected', async ({ page }) => {
    const connectBtn = page.locator('button.w-32.h-32')

    await connectBtn.click()
    await expect(page.getByText('Protected')).toBeVisible({ timeout: 5000 })

    await expect(page.getByText('Download')).toBeVisible()
    await expect(page.getByText('Upload')).toBeVisible()
    await expect(page.getByText('Duration')).toBeVisible()
    await expect(page.getByText('Latency')).toBeVisible()

    await page.waitForTimeout(2000)

    await takeScreenshot(page, 'flow-vpn-stats')
  })
})

test.describe('Region Selection Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)
  })

  test('open and close region selector', async ({ page }) => {
    const regionSelector = page.locator('.card-hover').first()

    await regionSelector.click()
    await expect(page.getByText('Fastest Server')).toBeVisible()
    await takeScreenshot(page, 'flow-region-open')

    await page.locator('.fixed.inset-0').click()
    await expect(page.getByText('Fastest Server')).not.toBeVisible()
  })

  test('select fastest server option', async ({ page }) => {
    const regionSelector = page.locator('.card-hover').first()

    await regionSelector.click()
    await page.getByText('Fastest Server').click()

    await expect(page.getByText('Fastest Server')).not.toBeVisible()
    await takeScreenshot(page, 'flow-region-fastest')
  })

  test('region selector disabled when connected', async ({ page }) => {
    const connectBtn = page.locator('button.w-32.h-32')
    const regionSelector = page.locator('.card-hover').first()

    await connectBtn.click()
    await expect(page.getByText('Protected')).toBeVisible({ timeout: 5000 })

    await expect(regionSelector).toHaveClass(/opacity-50/)
    await expect(regionSelector).toHaveAttribute('disabled', '')

    await takeScreenshot(page, 'flow-region-disabled')
  })
})

test.describe('Contribution Settings Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)
    await navigateToTab(page, 1)
  })

  test('toggle auto contribution setting', async ({ page }) => {
    const autoContributionRow = page.locator('button').filter({
      hasText: 'Auto Contribution',
    })
    await expect(autoContributionRow).toBeVisible()

    // Click to toggle
    await autoContributionRow.click()
    await page.waitForTimeout(300)

    await takeScreenshot(page, 'flow-contribution-toggle')
  })

  test('toggles earning mode setting', async ({ page }) => {
    const earningModeRow = page.locator('button').filter({
      hasText: 'Earning Mode',
    })
    await expect(earningModeRow).toBeVisible()

    await earningModeRow.click()
    await page.waitForTimeout(300)

    await takeScreenshot(page, 'flow-earning-mode-toggle')
  })
})

test.describe('Settings Toggle Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)
    await navigateToTab(page, 2)
  })

  test('toggles kill switch', async ({ page }) => {
    const killSwitchSection = page.locator('div').filter({
      hasText: /^Kill SwitchBlock internet if VPN disconnects$/,
    })

    const toggle = killSwitchSection.locator('button').first()
    await toggle.click()
    await page.waitForTimeout(300)

    await takeScreenshot(page, 'flow-settings-killswitch')
  })

  test('toggles auto connect', async ({ page }) => {
    const autoConnectSection = page.locator('div').filter({
      hasText: /^Auto ConnectConnect when app starts$/,
    })

    const toggle = autoConnectSection.locator('button').first()
    await toggle.click()
    await page.waitForTimeout(300)

    await takeScreenshot(page, 'flow-settings-autoconnect')
  })

  test('toggles start on boot', async ({ page }) => {
    const startOnBootSection = page.locator('div').filter({
      hasText: /^Start on BootLaunch VPN when system starts$/,
    })

    const toggle = startOnBootSection.locator('button').first()
    await toggle.click()
    await page.waitForTimeout(300)

    await takeScreenshot(page, 'flow-settings-autostart')
  })

  test('toggles adaptive bandwidth', async ({ page }) => {
    const adaptiveSection = page.locator('div').filter({
      hasText: /^Adaptive BandwidthShare more when idle/,
    })

    const toggle = adaptiveSection.locator('button').first()
    await toggle.click()
    await page.waitForTimeout(300)

    await takeScreenshot(page, 'flow-settings-adaptive')
  })

  test('toggles CDN caching', async ({ page }) => {
    const cdnSection = page.locator('div').filter({
      hasText: /^Edge CDN CachingCache and serve DWS content$/,
    })

    const toggle = cdnSection.locator('button').first()
    await toggle.click()
    await page.waitForTimeout(300)

    await takeScreenshot(page, 'flow-settings-cdn')
  })
})

test.describe('External Links Flow', () => {
  test('learn more link has correct href', async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)
    await navigateToTab(page, 2)

    const learnMoreLink = page.getByRole('link', { name: 'Learn More' })
    await expect(learnMoreLink).toBeVisible()
    await expect(learnMoreLink).toHaveAttribute(
      'href',
      'https://jejunetwork.org',
    )
    await expect(learnMoreLink).toHaveAttribute('target', '_blank')
  })
})

test.describe('Complete User Journey', () => {
  test('full app exploration without wallet', async ({ page }) => {
    await page.goto(VPN_URL)
    await waitForPageLoad(page)

    await expect(page.locator('h1:has-text("Jeju VPN")')).toBeVisible()
    await takeScreenshot(page, 'journey-01-vpn')

    const regionSelector = page.locator('.card-hover').first()
    await regionSelector.click()
    await expect(page.getByText('Fastest Server')).toBeVisible()
    await takeScreenshot(page, 'journey-02-regions')
    await page.locator('.fixed.inset-0').click()

    await navigateToTab(page, 1)
    await expect(page.getByText('Fair Contribution')).toBeVisible()
    await takeScreenshot(page, 'journey-03-contribution')

    await navigateToTab(page, 2)
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await takeScreenshot(page, 'journey-04-settings')

    const killSwitchToggle = page
      .locator('div')
      .filter({ hasText: /^Kill Switch/ })
      .locator('button')
      .first()
    await killSwitchToggle.click()
    await takeScreenshot(page, 'journey-05-toggle')

    await navigateToTab(page, 0)
    const connectBtn = page.locator('button.w-32.h-32')
    await connectBtn.click()
    await expect(page.getByText(/Connecting|Protected/)).toBeVisible({
      timeout: 5000,
    })
    await takeScreenshot(page, 'journey-06-connected')

    await connectBtn.click()
    await expect(page.getByText('Tap to Connect')).toBeVisible({
      timeout: 5000,
    })
    await takeScreenshot(page, 'journey-07-complete')
  })
})
