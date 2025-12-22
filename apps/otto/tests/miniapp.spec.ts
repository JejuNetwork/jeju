/**
 * Otto Miniapp E2E Tests
 * Tests web and Telegram miniapp functionality
 */

import { expect, test } from '@playwright/test'

const BASE_URL = process.env.OTTO_BASE_URL ?? 'http://localhost:4040'

test.describe('Otto Web Miniapp', () => {
  test('loads chat interface', async ({ page }) => {
    await page.goto(`${BASE_URL}/miniapp`)

    const input = page.locator('#input')
    await expect(input).toBeVisible()

    const sendButton = page.locator('#send')
    await expect(sendButton).toBeVisible()
  })

  test('can send and receive messages', async ({ page }) => {
    await page.goto(`${BASE_URL}/miniapp`)
    await page.waitForTimeout(1000)

    const input = page.locator('#input')
    await input.fill('hello')
    await page.locator('#send').click()

    await page.waitForTimeout(2000)

    const messages = page.locator('.msg')
    const count = await messages.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

test.describe('Otto Telegram Miniapp', () => {
  test('includes Telegram WebApp script', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/miniapp/telegram`)
    expect(response.ok()).toBeTruthy()

    const html = await response.text()
    expect(html).toContain('telegram-web-app.js')
  })
})
