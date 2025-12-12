import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const viewports = [
  { name: 'mobile-portrait', width: 375, height: 812 },
  { name: 'mobile-landscape', width: 812, height: 375 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 720 },
]

for (const viewport of viewports) {
  test.describe(`Responsive with Wallet - ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test(`Dashboard renders correctly on ${viewport.name}`, async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

      await page.goto('/')

      // Connect wallet
      if (viewport.width < 1024) {
        await page.locator('button[aria-label="Toggle menu"]').click()
        await page.waitForTimeout(300)
        await page.locator('nav.fixed').getByRole('button', { name: /Connect Wallet/i }).click()
      } else {
        await page.getByRole('button', { name: /Connect/i }).click()
      }
      
      await metamask.connectToDapp()
      await page.waitForTimeout(2000)

      // Verify page elements
      await expect(page.getByRole('heading', { name: /Decentralized/i })).toBeVisible()
      await expect(page.getByRole('link', { name: /Upload Files/i }).first()).toBeVisible()
      await expect(page.getByRole('link', { name: /Browse Files/i })).toBeVisible()
    })

    test(`Upload page renders correctly on ${viewport.name}`, async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

      await page.goto('/')

      // Connect wallet
      if (viewport.width < 1024) {
        await page.locator('button[aria-label="Toggle menu"]').click()
        await page.waitForTimeout(300)
        await page.locator('nav.fixed').getByRole('button', { name: /Connect Wallet/i }).click()
      } else {
        await page.getByRole('button', { name: /Connect/i }).click()
      }
      
      await metamask.connectToDapp()
      await page.waitForTimeout(2000)

      await page.goto('/upload')
      
      await expect(page.getByRole('heading', { name: /Upload Files/i })).toBeVisible()
      await expect(page.getByRole('link', { name: /Back to Dashboard/i })).toBeVisible()
      await expect(page.locator('.upload-zone').first()).toBeVisible()
    })

    test(`Files page renders correctly on ${viewport.name}`, async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

      await page.goto('/')

      // Connect wallet
      if (viewport.width < 1024) {
        await page.locator('button[aria-label="Toggle menu"]').click()
        await page.waitForTimeout(300)
        await page.locator('nav.fixed').getByRole('button', { name: /Connect Wallet/i }).click()
      } else {
        await page.getByRole('button', { name: /Connect/i }).click()
      }
      
      await metamask.connectToDapp()
      await page.waitForTimeout(2000)

      await page.goto('/files')
      
      await expect(page.getByRole('heading', { name: /Files/i })).toBeVisible()
      await expect(page.getByPlaceholder(/Search by CID/i)).toBeVisible()
      await expect(page.locator('select')).toBeVisible()
    })

    test(`Settings page renders correctly on ${viewport.name}`, async ({ context, page, metamaskPage, extensionId }) => {
      const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

      await page.goto('/')

      // Connect wallet
      if (viewport.width < 1024) {
        await page.locator('button[aria-label="Toggle menu"]').click()
        await page.waitForTimeout(300)
        await page.locator('nav.fixed').getByRole('button', { name: /Connect Wallet/i }).click()
      } else {
        await page.getByRole('button', { name: /Connect/i }).click()
      }
      
      await metamask.connectToDapp()
      await page.waitForTimeout(2000)

      await page.goto('/settings')
      
      await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible()
      await expect(page.getByText(/Connected Wallet/i)).toBeVisible()
      await expect(page.getByRole('heading', { name: /Storage Backends/i })).toBeVisible()
    })
  })
}




