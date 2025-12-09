import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Wallet Connection - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('should connect MetaMask wallet to Storage', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()

    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  })

  test('should display wallet address in header after connection', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await page.waitForTimeout(1000)
    await metamask.connectToDapp()

    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  })

  test('should persist connection after page reload', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    await page.reload()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })
  })

  test('should open wallet dropdown on click', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    await page.getByText(/0xf39F/i).click()
    await expect(page.getByText(/Connected Wallet/i)).toBeVisible()
  })

  test('should disconnect wallet when clicking disconnect', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    await page.getByText(/0xf39F/i).click()
    await page.getByRole('button', { name: /Disconnect/i }).click()
    await expect(page.getByRole('button', { name: /Connect/i })).toBeVisible()
  })
})

test.describe('Wallet Connection - Mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('should connect wallet via mobile menu', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    // Open mobile menu
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    
    // Click connect wallet in menu
    await page.locator('nav.fixed').getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()

    // Verify connected
    await page.waitForTimeout(2000)
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    
    await expect(page.locator('nav.fixed').getByText(/Connected/i)).toBeVisible({ timeout: 15000 })
  })

  test('should disconnect wallet via mobile menu', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    // Connect first
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await page.waitForTimeout(2000)

    // Open menu and disconnect
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('button', { name: /Disconnect/i }).click()
    await page.waitForTimeout(300)

    // Verify disconnected
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await expect(page.locator('nav.fixed').getByRole('button', { name: /Connect Wallet/i })).toBeVisible()
  })
})
