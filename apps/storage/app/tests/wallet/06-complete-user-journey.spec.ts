import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('Complete User Journey - Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('full user journey: connect, explore all pages, test all buttons, disconnect', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    // 1. Land on homepage
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Decentralized/i })).toBeVisible()

    // 2. Connect wallet
    await page.getByRole('button', { name: /Connect/i }).click()
    await metamask.connectToDapp()
    await expect(page.getByText(/0xf39F/i)).toBeVisible({ timeout: 15000 })

    // 3. Check dashboard stats
    await expect(page.getByText(/Total Files/i)).toBeVisible()
    await expect(page.getByText(/Storage Used/i)).toBeVisible()

    // 4. Click Upload Files CTA
    await page.getByRole('link', { name: /Upload Files/i }).first().click()
    await expect(page).toHaveURL('/upload')
    await expect(page.getByRole('heading', { name: /Upload Files/i })).toBeVisible()

    // 5. Verify upload zone is clickable
    const uploadZone = page.locator('.upload-zone').first()
    await expect(uploadZone).toBeVisible()

    // 6. Navigate back to Dashboard
    await page.getByRole('link', { name: /Back to Dashboard/i }).click()
    await expect(page).toHaveURL('/')

    // 7. Click Browse Files CTA
    await page.getByRole('link', { name: /Browse Files/i }).click()
    await expect(page).toHaveURL('/files')
    await expect(page.getByRole('heading', { name: /Files/i })).toBeVisible()

    // 8. Test Files page controls
    await expect(page.getByPlaceholder(/Search by CID/i)).toBeVisible()
    await page.getByPlaceholder(/Search by CID/i).fill('test')
    await page.getByPlaceholder(/Search by CID/i).fill('')
    
    // Status filter
    await page.locator('select').selectOption('pinned')
    await page.locator('select').selectOption('all')

    // View toggle
    const listBtn = page.locator('button').filter({ has: page.locator('svg.lucide-list') })
    await listBtn.click()
    const gridBtn = page.locator('button').filter({ has: page.locator('svg.lucide-grid') })
    await gridBtn.click()

    // 9. Navigate to Settings via header
    await page.locator('header nav').getByRole('link', { name: /Settings/i }).click()
    await expect(page).toHaveURL('/settings')
    await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible()

    // 10. Verify wallet shown in Settings
    await expect(page.getByText(/Connected Wallet/i)).toBeVisible()

    // 11. Navigate back to Dashboard via logo
    await page.getByRole('link', { name: /Storage/i }).first().click()
    await expect(page).toHaveURL('/')

    // 12. Test Configure link
    await page.getByRole('link', { name: /Configure/i }).click()
    await expect(page).toHaveURL('/settings')

    // 13. Go back
    await page.getByRole('link', { name: /Back to Dashboard/i }).click()
    await expect(page).toHaveURL('/')

    // 14. Toggle theme
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

    // 15. Disconnect wallet
    await page.getByText(/0xf39F/i).click()
    await page.getByRole('button', { name: /Disconnect/i }).click()
    await expect(page.getByRole('button', { name: /Connect/i })).toBeVisible()
  })
})

test.describe('Complete User Journey - Mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('full mobile journey: connect, explore, disconnect', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    // 1. Land on homepage
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Decentralized/i })).toBeVisible()

    // 2. Open mobile menu and connect
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('button', { name: /Connect Wallet/i }).click()
    await metamask.connectToDapp()
    await page.waitForTimeout(2000)

    // 3. Navigate to Upload via menu
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('link', { name: /Upload/i }).click()
    await expect(page).toHaveURL('/upload')

    // 4. Verify upload zone
    await expect(page.locator('.upload-zone').first()).toBeVisible()

    // 5. Navigate to Files via menu
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('link', { name: /Files/i }).click()
    await expect(page).toHaveURL('/files')

    // 6. Test files controls
    await expect(page.getByPlaceholder(/Search by CID/i)).toBeVisible()
    await expect(page.locator('select')).toBeVisible()

    // 7. Navigate to Settings
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('link', { name: /Settings/i }).click()
    await expect(page).toHaveURL('/settings')

    // 8. Verify settings sections
    await expect(page.getByText(/Connected Wallet/i)).toBeVisible()

    // 9. Navigate to Dashboard
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('link', { name: /Dashboard/i }).click()
    await expect(page).toHaveURL('/')

    // 10. Toggle theme
    const themeBtn = page.locator('button[aria-label*="mode"]')
    await themeBtn.click()
    await page.waitForTimeout(300)

    // 11. Disconnect
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await page.locator('nav.fixed').getByRole('button', { name: /Disconnect/i }).click()
    await page.waitForTimeout(300)

    // 12. Verify disconnected
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.waitForTimeout(300)
    await expect(page.locator('nav.fixed').getByRole('button', { name: /Connect Wallet/i })).toBeVisible()
  })
})


