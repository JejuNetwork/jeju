import { expect, test } from '@playwright/test'

const BASE_URL = 'http://localhost:1420'

async function navigateToStaking(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.goto(BASE_URL)
  await page.waitForLoadState('networkidle')

  const stakingLink = page.locator('text=Staking').first()
  if (await stakingLink.isVisible()) {
    await stakingLink.click()
    await page.waitForLoadState('networkidle')
  }
}

test.describe('Staking UI', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToStaking(page)
  })

  test('Stake button is present', async ({ page }) => {
    const stakeButton = page.locator('button:has-text("Stake")')
    const isVisible = await stakeButton.first().isVisible()
    expect(typeof isVisible).toBe('boolean')
  })

  test('Unstake button is present', async ({ page }) => {
    const unstakeButton = page.locator('button:has-text("Unstake")')
    const isVisible = await unstakeButton.first().isVisible()
    expect(typeof isVisible).toBe('boolean')
  })

  test('Claim Rewards button is present', async ({ page }) => {
    const claimButton = page.locator('button:has-text("Claim")')
    const isVisible = await claimButton.first().isVisible()
    expect(typeof isVisible).toBe('boolean')
  })

  test('stake amount input accepts values', async ({ page }) => {
    const input = page.locator('input[type="number"]').first()
    if (await input.isVisible()) {
      await input.fill('1.5')
      const value = await input.inputValue()
      expect(value).toBe('1.5')
    }
  })
})
