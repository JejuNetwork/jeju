import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('All Pages with Wallet Connected - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('Dashboard shows wallet info when connected', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    // All dashboard elements should be visible
    await expect(page.getByRole('heading', { name: /Decentralized/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Upload Files/i }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Browse Files/i })).toBeVisible()
  })

  test('Upload page shows wallet when connected', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    await page.goto('/upload')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
    await expect(page.getByRole('heading', { name: /Upload Files/i })).toBeVisible()
  })

  test('Files page shows wallet when connected', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    await page.goto('/files')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
    await expect(page.getByRole('heading', { name: /Files/i })).toBeVisible()
  })

  test('Settings page shows connected wallet info', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    await page.goto('/settings')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
    await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible()
    
    // Account section should show connected wallet
    await expect(page.getByText(/Connected Wallet/i)).toBeVisible()
    await expect(page.getByText(/Wallet connected/i)).toBeVisible()
    await expect(page.getByText(/Ready to upload/i)).toBeVisible()
  })
})

test.describe('All Pages with Wallet Connected - Mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('Wallet persists across mobile navigation', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    // Connect via mobile menu
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await page.waitForTimeout(2000)

    // Navigate to Upload
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('link', { name: /Upload/i }).click()
    await expect(page).toHaveURL('/upload')

    // Check wallet still connected in menu
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await expect(page.locator('nav.fixed').getByText(/Connected/i)).toBeVisible()

    // Navigate to Files
    await page.locator('nav.fixed').getByRole('link', { name: /Files/i }).click()
    await expect(page).toHaveURL('/files')

    // Check wallet still connected
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await expect(page.locator('nav.fixed').getByText(/Connected/i)).toBeVisible()

    // Navigate to Settings
    await page.locator('nav.fixed').getByRole('link', { name: /Settings/i }).click()
    await expect(page).toHaveURL('/settings')

    // Settings should show connected wallet
    await expect(page.getByText(/Connected Wallet/i)).toBeVisible()
  })
})




