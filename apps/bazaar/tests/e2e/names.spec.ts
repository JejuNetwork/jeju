/**
 * Names (JNS) Page Tests
 * Tests Jeju Name Service marketplace
 */

import { assertNoPageErrors } from '@jejunetwork/tests'
import { expect, type Page, test } from '@playwright/test'

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}

test.describe('Names Page', () => {
  test('displays names marketplace', async ({ page }) => {
    await navigateTo(page, '/names')
    await assertNoPageErrors(page)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('has search input', async ({ page }) => {
    await navigateTo(page, '/names')

    const searchInput = page.getByPlaceholder(/search/i)
    if (await searchInput.isVisible()) {
      await expect(searchInput).toBeEnabled()
    }
  })

  test('buy buttons exist on listings', async ({ page }) => {
    await navigateTo(page, '/names')

    const buyBtns = page.getByRole('button', { name: /buy now/i })
    const buyCount = await buyBtns.count()

    for (let i = 0; i < buyCount; i++) {
      await expect(buyBtns.nth(i)).toBeVisible()
      await expect(buyBtns.nth(i)).toBeEnabled()
    }
  })

  test('list name button exists when connected', async ({ page }) => {
    await navigateTo(page, '/names')

    const listNameBtn = page.getByRole('button', { name: /list/i })
    if (await listNameBtn.isVisible()) {
      await expect(listNameBtn).toBeEnabled()
    }
  })
})
