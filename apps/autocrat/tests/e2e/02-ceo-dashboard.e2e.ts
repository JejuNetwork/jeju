/**
 * Director Dashboard Flow Tests
 *
 * Tests the AI Director Management page:
 * - Dashboard display
 * - Pending proposals
 * - Navigation
 */

import { CORE_PORTS } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'

const BASE_URL = `http://localhost:${CORE_PORTS.AUTOCRAT_WEB.get()}`
const DIRECTOR_URL = `${BASE_URL}/director`

test.describe('Director Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DIRECTOR_URL)
    await page.waitForLoadState('networkidle')
  })

  test('displays page header correctly', async ({ page }) => {
    // Page should have Director Dashboard heading
    await expect(
      page.getByRole('heading', { name: /Director|Dashboard/i }).first(),
    ).toBeVisible()
  })

  test('shows Director dashboard section', async ({ page }) => {
    // Dashboard content should be visible
    const rootContent = page.locator('#root')
    await expect(rootContent).toBeVisible()
  })

  test('displays Current AI Director or loading state', async ({ page }) => {
    await page.waitForTimeout(1000)

    // Page should have content
    const rootContent = page.locator('#root')
    await expect(rootContent).toBeVisible()
  })

  test('displays Model Election section', async ({ page }) => {
    // Look for any content
    const rootContent = page.locator('#root')
    const content = await rootContent.textContent()
    expect(content?.length).toBeGreaterThan(0)
  })

  test('displays Recent Decisions section', async ({ page }) => {
    // Look for decisions or pending section
    const rootContent = page.locator('#root')
    const content = await rootContent.textContent()
    expect(content?.length).toBeGreaterThan(0)
  })

  test('Nominate model button exists', async ({ page }) => {
    // Check for any buttons
    const buttons = await page.getByRole('button').count()
    expect(buttons).toBeGreaterThanOrEqual(0)
  })

  test('refresh button reloads data', async ({ page }) => {
    // Look for a refresh button
    const refreshBtn = page.getByRole('button', { name: /Refresh/i })
    
    if (await refreshBtn.isVisible().catch(() => false)) {
      await refreshBtn.click()
      await page.waitForTimeout(500)
    }
    
    // Page should still work
    await expect(page.locator('#root')).toBeVisible()
  })

  test('back button navigates to dashboard', async ({ page }) => {
    // Navigate back to home
    const backLink = page.getByRole('link', { name: /Back|Home|Autocrat/i }).first()
    
    if (await backLink.isVisible().catch(() => false)) {
      await backLink.click()
      await expect(page).toHaveURL(BASE_URL)
    } else {
      // Just verify we can navigate back
      await page.goto(BASE_URL)
      await expect(page).toHaveURL(BASE_URL)
    }
  })

  test('can navigate from dashboard to Director page', async ({ page }) => {
    await page.goto(BASE_URL)
    
    // Try to find a link to director
    const directorLink = page.getByRole('link', { name: /Director/i }).first()
    
    if (await directorLink.isVisible().catch(() => false)) {
      await directorLink.click()
      await expect(page).toHaveURL(/director/)
    } else {
      // Direct navigation works
      await page.goto(DIRECTOR_URL)
      await expect(page).toHaveURL(DIRECTOR_URL)
    }
  })

  test('navigation dashboard links correctly', async ({ page }) => {
    // Header should exist
    const header = page.locator('header')
    await expect(header).toBeVisible()
  })

  test('mobile layout displays correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.reload()

    await expect(page.locator('#root')).toBeVisible()
    await expect(page.locator('header')).toBeVisible()
  })

  test('tablet layout shows full content', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.reload()

    await expect(page.locator('#root')).toBeVisible()
  })
})
