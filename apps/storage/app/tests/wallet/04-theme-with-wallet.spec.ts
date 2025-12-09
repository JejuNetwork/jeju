import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Theme Toggle with Wallet - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('theme toggle works with wallet connected', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    const themeBtn = page.locator('button[aria-label*="mode"]')
    
    const initialDark = await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    )
    
    await themeBtn.click()
    await page.waitForTimeout(300)
    
    const afterToggle = await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    )
    
    expect(afterToggle).toBe(!initialDark)
    
    // Wallet should still be visible
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
  })

  test('theme persists across navigation with wallet', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    // Set to dark
    const themeBtn = page.locator('button[aria-label*="mode"]')
    const isDark = await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    )
    if (!isDark) {
      await themeBtn.click()
      await page.waitForTimeout(300)
    }

    // Navigate to Upload
    await page.goto('/upload')
    expect(await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    )).toBe(true)
    await expect(page.getByText(/0xf39F/i)).toBeVisible()

    // Navigate to Files
    await page.goto('/files')
    expect(await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    )).toBe(true)
    await expect(page.getByText(/0xf39F/i)).toBeVisible()

    // Navigate to Settings
    await page.goto('/settings')
    expect(await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    )).toBe(true)
    await expect(page.getByText(/0xf39F/i)).toBeVisible()
  })
})

test.describe('Theme Toggle with Wallet - Mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('theme toggle works with wallet on mobile', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/')
    
    // Connect
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await page.waitForTimeout(2000)

    // Toggle theme
    const themeBtn = page.locator('button[aria-label*="mode"]')
    
    const initialDark = await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    )
    
    await themeBtn.click()
    await page.waitForTimeout(300)
    
    const afterToggle = await page.evaluate(() => 
      document.documentElement.classList.contains('dark')
    )
    
    expect(afterToggle).toBe(!initialDark)

    // Verify wallet still connected in menu
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await expect(page.locator('nav.fixed').getByText(/Connected/i)).toBeVisible()
  })
})


