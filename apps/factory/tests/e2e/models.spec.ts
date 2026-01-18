/**
 * Models E2E Tests
 * Tests model hub listing, detail view, inference playground, and discussions
 */

import { expect, test } from '@playwright/test'

const isRemote =
  process.env.JEJU_NETWORK === 'testnet' ||
  process.env.JEJU_NETWORK === 'mainnet'

test.describe('Model Hub', () => {
  test.skip(isRemote, 'Skipping on remote network')
  test('displays model hub page', async ({ page }) => {
    await page.goto('/models')
    await expect(
      page.getByRole('heading', { name: /model hub/i }),
    ).toBeVisible()
  })

  test('shows model stats', async ({ page }) => {
    await page.goto('/models')
    await expect(page.getByText(/total models/i)).toBeVisible()
    await expect(page.getByText(/total downloads/i)).toBeVisible()
  })

  test('filters by model type', async ({ page }) => {
    await page.goto('/models')

    const typeFilters = [
      'All Models',
      'LLM',
      'Vision',
      'Audio',
      'Embedding',
      'Multimodal',
    ]

    for (const filter of typeFilters) {
      const button = page.getByRole('button', {
        name: new RegExp(filter, 'i'),
      })
      if (await button.isVisible()) {
        await button.click()
        await expect(button).toHaveClass(/bg-accent/)
        break
      }
    }
  })

  test('searches models', async ({ page }) => {
    await page.goto('/models')
    const searchInput = page.getByPlaceholder(/search models/i)
    await searchInput.fill('llama')
    await expect(searchInput).toHaveValue('llama')
  })

  test('sorts models', async ({ page }) => {
    await page.goto('/models')
    const sortSelect = page.locator('select').first()
    if (await sortSelect.isVisible()) {
      await sortSelect.selectOption('stars')
    }
  })

  test('displays model cards', async ({ page }) => {
    await page.goto('/models')
    const modelCard = page.locator('.card').first()
    await expect(modelCard).toBeVisible()
  })

  test('shows upload model button', async ({ page }) => {
    await page.goto('/models')
    await expect(
      page.getByRole('link', { name: /upload model/i }),
    ).toBeVisible()
  })
})

test.describe('Model Detail', () => {
  test.skip(isRemote, 'Skipping model detail on remote network')
  test('displays model header', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await expect(
      page.getByRole('heading', { name: /llama-3-jeju-ft/i }).first(),
    ).toBeVisible()
  })

  test('shows model badges', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await expect(page.locator('.badge').first()).toBeVisible()
  })

  test('displays model stats', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await expect(page.getByText(/downloads/i).first()).toBeVisible()
    await expect(page.getByText(/parameters/i).first()).toBeVisible()
  })

  test('shows model tabs', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await expect(
      page.getByRole('button', { name: /model card/i }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /files/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /inference/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /training/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /versions/i })).toBeVisible()
  })

  test('switches to files tab', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /files/i }).click()
    await expect(page.getByRole('main')).toBeVisible()
  })
})

test.describe('Inference Playground', () => {
  test.skip(isRemote, 'Skipping inference playground on remote network')
  test('displays inference tab', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /inference/i }).click()
    await expect(page.getByText(/input/i)).toBeVisible()
  })

  test('shows prompt textarea', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /inference/i }).click()
    await expect(page.locator('textarea')).toBeVisible()
  })

  test('shows generate button', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /inference/i }).click()
    await expect(page.getByRole('button', { name: /generate/i })).toBeVisible()
  })

  test('shows configuration sliders', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /inference/i }).click()
    await expect(page.getByText(/configuration/i)).toBeVisible()
    await expect(page.getByText(/max tokens/i)).toBeVisible()
    await expect(page.getByText(/temperature/i)).toBeVisible()
  })

  test('types prompt in textarea', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /inference/i }).click()

    const textarea = page.locator('textarea')
    await textarea.fill('Write a Solidity function')
    await expect(textarea).toHaveValue('Write a Solidity function')
  })

  test('triggers generation on button click', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /inference/i }).click()

    await page.locator('textarea').fill('Write a simple function')
    await page.getByRole('button', { name: /generate/i }).click()

    await expect(page.getByText(/generating|output/i).first()).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows API endpoint', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /inference/i }).click()

    await expect(page.getByText(/api endpoint/i)).toBeVisible()
    await expect(
      page.locator('code').filter({ hasText: /inference\.jeju/i }),
    ).toBeVisible()
  })

  test('adjusts config sliders', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /inference/i }).click()

    const sliders = page.locator('input[type="range"]')
    const count = await sliders.count()
    if (count > 0) {
      await sliders.first().fill('500')
    }
  })
})

test.describe('Training Tab', () => {
  test.skip(isRemote, 'Skipping training tab on remote network')
  test('displays training options', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /training/i }).click()
    await expect(page.getByText(/train on jeju compute/i)).toBeVisible()
  })

  test('shows training plans', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /training/i }).click()
    await expect(page.getByText(/qlora|fine-tuning|dpo/i).first()).toBeVisible()
  })

  test('shows pricing', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft')
    await page.getByRole('button', { name: /training/i }).click()
    await expect(page.getByText(/ETH/i).first()).toBeVisible()
  })
})

test.describe('Model Upload', () => {
  test.skip(isRemote, 'Skipping model upload on remote network')
  test('navigates to upload page', async ({ page }) => {
    await page.goto('/models/upload')
    await expect(page.getByRole('heading', { name: /upload/i })).toBeVisible()
  })

  test('shows upload form fields', async ({ page }) => {
    await page.goto('/models/upload')
    await expect(page.locator('input, select, textarea').first()).toBeVisible()
  })
})

test.describe('Model Discussions', () => {
  test.skip(isRemote, 'Skipping model discussions on remote network')
  test('displays discussions page', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')
    await expect(
      page.getByRole('heading', { name: /discussions/i }),
    ).toBeVisible()
  })

  test('shows new discussion button', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')
    await expect(
      page.getByRole('button', { name: /new discussion/i }),
    ).toBeVisible()
  })

  test('has search functionality', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')
    const searchInput = page.getByPlaceholder(/search discussions/i)
    await expect(searchInput).toBeVisible()
  })

  test('has category filter', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')
    await expect(page.getByRole('combobox')).toBeVisible()
  })

  test('displays discussion list', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')
    await expect(page.locator('.card').first()).toBeVisible()
  })

  test('opens new discussion form', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')
    await page.getByRole('button', { name: /new discussion/i }).click()

    await expect(page.getByText(/start a discussion/i)).toBeVisible()
    await expect(
      page.getByPlaceholder(/what would you like to discuss/i),
    ).toBeVisible()
  })

  test('shows category selector in form', async ({ page }) => {
    await page.goto('/models/jeju/llama-3-jeju-ft/discussions')
    await page.getByRole('button', { name: /new discussion/i }).click()

    await expect(
      page.getByRole('button', { name: /^question$/i }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /^general$/i })).toBeVisible()
  })
})
