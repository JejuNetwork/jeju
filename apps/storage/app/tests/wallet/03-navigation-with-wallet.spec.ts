import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Navigation with Wallet - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('all nav links work with wallet connected', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    // Test all nav links
    await page.locator('header nav').getByRole('link', { name: /Upload/i }).click()
    await expect(page).toHaveURL('/upload')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()

    await page.locator('header nav').getByRole('link', { name: /Files/i }).click()
    await expect(page).toHaveURL('/files')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()

    await page.locator('header nav').getByRole('link', { name: /Settings/i }).click()
    await expect(page).toHaveURL('/settings')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()

    await page.locator('header nav').getByRole('link', { name: /Dashboard/i }).click()
    await expect(page).toHaveURL('/')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
  })

  test('CTA buttons work with wallet connected', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    // Upload Files CTA
    await page.getByRole('link', { name: /Upload Files/i }).first().click()
    await expect(page).toHaveURL('/upload')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()

    // Back to Dashboard
    await page.getByRole('link', { name: /Back to Dashboard/i }).click()
    await expect(page).toHaveURL('/')

    // Browse Files CTA
    await page.getByRole('link', { name: /Browse Files/i }).click()
    await expect(page).toHaveURL('/files')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
  })

  test('Configure link works with wallet connected', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    await page.getByRole('link', { name: /Configure/i }).click()
    await expect(page).toHaveURL('/settings')
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
  })
})

test.describe('Navigation with Wallet - Mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('all mobile menu links work with wallet connected', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    // Connect
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

    // Navigate to Files
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('link', { name: /Files/i }).click()
    await expect(page).toHaveURL('/files')

    // Navigate to Settings
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('link', { name: /Settings/i }).click()
    await expect(page).toHaveURL('/settings')

    // Navigate to Dashboard
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('link', { name: /Dashboard/i }).click()
    await expect(page).toHaveURL('/')
  })
})




