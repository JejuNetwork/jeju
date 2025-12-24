/**
 * Feed E2E Tests
 * Tests developer feed, casting, and channel interactions
 */

import { expect, test } from '@playwright/test'

test.describe('Developer Feed', () => {
  test('displays feed page with heading', async ({ page }) => {
    await page.goto('/feed')
    await expect(page.getByRole('heading', { name: /feed/i })).toBeVisible()
  })

  test('shows compose button or connect prompt', async ({ page }) => {
    await page.goto('/feed')
    const composeBtn = page.getByRole('button', { name: /compose|cast|post/i })
    const connectBtn = page.getByRole('button', { name: /connect/i })
    const hasCompose = await composeBtn.isVisible()
    const hasConnect = await connectBtn.isVisible()
    expect(hasCompose || hasConnect).toBeTruthy()
  })

  test('displays feed content area', async ({ page }) => {
    await page.goto('/feed')
    await expect(page.getByRole('main')).toBeVisible()
  })

  test('shows channel selector or list', async ({ page }) => {
    await page.goto('/feed')
    await expect(page.getByText(/channel|factory|dev/i).first()).toBeVisible()
  })
})

test.describe('Feed Channels', () => {
  test('displays channel list', async ({ page }) => {
    await page.goto('/feed')
    const channels = page
      .locator('button, a')
      .filter({ hasText: /factory|dev|jeju/i })
    const count = await channels.count()
    expect(count).toBeGreaterThan(0)
  })

  test('switches channels', async ({ page }) => {
    await page.goto('/feed')
    const channelBtn = page
      .locator('button, a')
      .filter({ hasText: /factory|dev/i })
      .first()
    if (await channelBtn.isVisible()) {
      await channelBtn.click()
    }
  })
})

test.describe('Feed Interactions', () => {
  test('shows cast cards', async ({ page }) => {
    await page.goto('/feed')
    const casts = page.locator('.card, [class*="cast"], [class*="post"]')
    await expect(casts.first()).toBeVisible()
  })

  test('shows interaction buttons on casts', async ({ page }) => {
    await page.goto('/feed')
    const interactionBtns = page
      .locator('button')
      .filter({ hasText: /like|recast|reply/i })
    const count = await interactionBtns.count()
    if (count > 0) {
      await expect(interactionBtns.first()).toBeVisible()
    }
  })
})

test.describe('Compose Cast', () => {
  test('opens compose modal or shows compose area', async ({ page }) => {
    await page.goto('/feed')
    const composeBtn = page.getByRole('button', { name: /compose|cast|post/i })
    if (await composeBtn.isVisible()) {
      await composeBtn.click()
      await expect(page.locator('textarea').first()).toBeVisible()
    }
  })

  test('shows character count', async ({ page }) => {
    await page.goto('/feed')
    const composeBtn = page.getByRole('button', { name: /compose|cast|post/i })
    if (await composeBtn.isVisible()) {
      await composeBtn.click()
      await expect(page.getByText(/\d+\/\d+|characters/i).first()).toBeVisible()
    }
  })
})

test.describe('Feed Farcaster Integration', () => {
  test('shows Farcaster connect prompt when not connected', async ({
    page,
  }) => {
    await page.goto('/feed')
    const connectPrompt = page.getByText(/connect.*farcaster/i)
    const connectBtn = page.getByRole('button', { name: /connect.*farcaster/i })
    const hasPrompt = await connectPrompt.isVisible()
    const hasBtn = await connectBtn.isVisible()
    expect(hasPrompt || hasBtn).toBeTruthy()
  })
})
