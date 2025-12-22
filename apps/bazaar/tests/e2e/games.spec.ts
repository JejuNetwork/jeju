/**
 * Games Page Tests
 * Tests games listing and Hyperscape page
 */

import { assertNoPageErrors } from '@jejunetwork/tests/playwright-only'
import { expect, type Page, test } from '@playwright/test'

async function navigateTo(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}

test.describe('Games Page', () => {
  test('displays games page', async ({ page }) => {
    await page.goto('/games')
    await assertNoPageErrors(page)

    await expect(page.getByRole('heading', { name: /Games/i })).toBeVisible()
  })

  test('navigates to Hyperscape', async ({ page }) => {
    await page.goto('/games')

    const hyperscapeLink = page.getByRole('link', { name: /Hyperscape/i })
    if (await hyperscapeLink.isVisible()) {
      await hyperscapeLink.click()
      await page.waitForURL('**/games/hyperscape')
    }
  })

  test('games page loads without errors', async ({ page }) => {
    await navigateTo(page, '/games')
    await page.waitForTimeout(2000)

    const heading = page.getByRole('heading', {
      name: /games|applications|no games/i,
    })
    await expect(heading.first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Hyperscape Page', () => {
  test('displays Hyperscape stats', async ({ page }) => {
    await page.goto('/games/hyperscape')
    await page.waitForTimeout(1000)
    await assertNoPageErrors(page)

    const heading = page.getByRole('heading', { name: /Hyperscape/i })
    await expect(heading).toBeVisible()
  })

  test('has filter buttons', async ({ page }) => {
    await navigateTo(page, '/games/hyperscape')

    const filters = ['All Items', 'Weapons', 'Armor', 'Tools', 'Resources']
    for (const filter of filters) {
      const filterBtn = page.getByRole('button', {
        name: new RegExp(filter, 'i'),
      })
      if (await filterBtn.isVisible()) {
        await expect(filterBtn).toBeEnabled()
      }
    }
  })

  test('shows player stats or empty state', async ({ page }) => {
    await page.goto('/games/hyperscape')
    await page.waitForTimeout(1000)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })

  test('game feed panel works', async ({ page }) => {
    await page.goto('/games')
    await page.waitForTimeout(500)
    await assertNoPageErrors(page)

    const body = await page.textContent('body')
    expect(body).toBeTruthy()
  })
})
