import { expect, test } from '@playwright/test'

test.describe('VPN Connection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('h1')
  })

  test('displays disconnected state on load', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Jeju VPN')
    await expect(page.getByText('Disconnected')).toBeVisible()
  })

  test('displays available nodes', async ({ page }) => {
    await expect(page.getByText('Nodes')).toBeVisible()
  })

  test('connects to VPN', async ({ page }) => {
    const connectBtn = page.locator('button.w-32.h-32')
    await connectBtn.click()

    await expect(page.getByText('Protected')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Download')).toBeVisible()
    await expect(page.getByText('Upload')).toBeVisible()
  })

  test('disconnects from VPN', async ({ page }) => {
    const connectBtn = page.locator('button.w-32.h-32')

    await connectBtn.click()
    await expect(page.getByText('Protected')).toBeVisible({ timeout: 5000 })

    await connectBtn.click()
    await expect(page.getByText('Tap to Connect')).toBeVisible({
      timeout: 3000,
    })
  })

  test('shows connection stats when connected', async ({ page }) => {
    const connectBtn = page.locator('button.w-32.h-32')
    await connectBtn.click()

    await expect(page.getByText('Protected')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Download')).toBeVisible()
    await expect(page.getByText('Duration')).toBeVisible()
    await expect(page.getByText('Latency')).toBeVisible()
    await expect(page.getByText('Connection')).toBeVisible()
    await expect(page.getByText('Active')).toBeVisible()
  })
})
