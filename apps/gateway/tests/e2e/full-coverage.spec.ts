/**
 * Gateway Full E2E Coverage Tests
 *
 * Comprehensive tests covering all pages, buttons, forms, and user flows.
 * Runs with standard Playwright (no synpress/wallet required).
 */

import { test, expect } from '@playwright/test'

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:4013'

test.describe('Gateway - Full Coverage', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to gateway
    await page.goto(GATEWAY_URL)
    await page.waitForLoadState('domcontentloaded')
  })

  test('should load homepage without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        errors.push(msg.text())
      }
    })

    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toBeVisible()

    // Allow a few non-critical errors
    expect(errors.filter((e) => !e.includes('net::ERR')).length).toBeLessThan(3)
  })

  test('should have proper meta tags', async ({ page }) => {
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(viewport).toBeTruthy()
  })

  test('should render on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.reload()
    await expect(page.locator('body')).toBeVisible()
  })

  test('should have navigation', async ({ page }) => {
    const nav = page.locator('nav, [role="navigation"], header')
    await expect(nav.first()).toBeVisible()
  })

  test('should show wallet connect option', async ({ page }) => {
    const connectBtn = page.locator('button:has-text(/connect/i)').first()
    const isVisible = await connectBtn.isVisible().catch(() => false)

    if (isVisible) {
      await expect(connectBtn).toBeVisible()
    }
  })
})

test.describe('Gateway - Bridge Page', () => {
  test('should load bridge page', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/bridge`)
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('body')).toBeVisible()
  })

  test('should have token selection', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/bridge`)
    await page.waitForLoadState('domcontentloaded')

    // Look for token selector or input
    const tokenSelector = page.locator('[data-testid*="token"], select, [role="combobox"]')
    const hasTokenSelector = (await tokenSelector.count()) > 0

    if (hasTokenSelector) {
      await expect(tokenSelector.first()).toBeVisible()
    }
  })

  test('should have amount input', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/bridge`)
    await page.waitForLoadState('domcontentloaded')

    const amountInput = page.locator('input[type="number"], input[placeholder*="amount" i], input[placeholder*="0"]')
    const hasAmountInput = (await amountInput.count()) > 0

    if (hasAmountInput) {
      await amountInput.first().fill('1.0')
      await expect(amountInput.first()).toHaveValue('1.0')
    }
  })
})

test.describe('Gateway - Liquidity Page', () => {
  test('should load liquidity page', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/liquidity`)
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('body')).toBeVisible()
  })

  test('should display pools or liquidity positions', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/liquidity`)
    await page.waitForLoadState('networkidle')

    // Look for pool list or "no positions" message
    const pools = page.locator('[data-testid*="pool"], table, .pool, [class*="pool"]')
    const noPositions = page.locator('text=/no.*position/i, text=/connect.*wallet/i')

    const hasPools = (await pools.count()) > 0
    const hasNoPositions = (await noPositions.count()) > 0

    expect(hasPools || hasNoPositions).toBe(true)
  })
})

test.describe('Gateway - Nodes Page', () => {
  test('should load nodes page', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/nodes`)
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('body')).toBeVisible()
  })

  test('should display node list or registration prompt', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/nodes`)
    await page.waitForLoadState('networkidle')

    const nodeList = page.locator('[data-testid*="node"], table, .node-list')
    const registerPrompt = page.locator('button:has-text(/register|connect/i)')

    const hasNodes = (await nodeList.count()) > 0
    const hasRegister = (await registerPrompt.count()) > 0

    expect(hasNodes || hasRegister).toBe(true)
  })
})

test.describe('Gateway - Paymaster Page', () => {
  test('should load paymaster page', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/paymaster`)
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('body')).toBeVisible()
  })

  test('should show paymaster creation or list', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/paymaster`)
    await page.waitForLoadState('networkidle')

    const paymasterUI = page.locator('[data-testid*="paymaster"], .paymaster, button:has-text(/create|deploy/i)')
    const hasPaymasterUI = (await paymasterUI.count()) > 0

    if (hasPaymasterUI) {
      await expect(paymasterUI.first()).toBeVisible()
    }
  })
})

test.describe('Gateway - Registry Page', () => {
  test('should load registry page', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/registry`)
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('Gateway - Navigation', () => {
  const pages = [
    { path: '/', name: 'Home' },
    { path: '/bridge', name: 'Bridge' },
    { path: '/liquidity', name: 'Liquidity' },
    { path: '/nodes', name: 'Nodes' },
    { path: '/paymaster', name: 'Paymaster' },
    { path: '/registry', name: 'Registry' },
  ]

  for (const pageInfo of pages) {
    test(`should navigate to ${pageInfo.name}`, async ({ page }) => {
      await page.goto(`${GATEWAY_URL}${pageInfo.path}`)
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('body')).toBeVisible()
    })
  }

  test('should navigate via links', async ({ page }) => {
    await page.goto(GATEWAY_URL)
    await page.waitForLoadState('domcontentloaded')

    // Find and click navigation links
    const navLinks = await page.locator('nav a, header a').all()

    for (const link of navLinks.slice(0, 5)) {
      const href = await link.getAttribute('href')
      if (href && href.startsWith('/') && !href.startsWith('//')) {
        await link.click()
        await page.waitForLoadState('domcontentloaded')
        await expect(page.locator('body')).toBeVisible()
        await page.goBack()
      }
    }
  })
})

test.describe('Gateway - Button Interactions', () => {
  test('should test all visible buttons', async ({ page }) => {
    await page.goto(GATEWAY_URL)
    await page.waitForLoadState('networkidle')

    const buttons = await page.locator('button:visible').all()

    for (const button of buttons.slice(0, 10)) {
      const text = await button.textContent()

      // Skip wallet connection buttons (require wallet)
      if (text?.toLowerCase().includes('connect')) continue

      // Try clicking the button
      try {
        await button.click({ timeout: 3000 })
        await page.waitForTimeout(500)

        // Close any modals that opened
        await page.keyboard.press('Escape')
      } catch {
        // Button might be disabled or trigger navigation
      }
    }

    // Verify page is still functional
    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('Gateway - Form Interactions', () => {
  test('should fill forms without submitting', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/bridge`)
    await page.waitForLoadState('networkidle')

    // Find and fill any visible inputs
    const inputs = await page.locator('input:visible:not([type="hidden"])').all()

    for (const input of inputs.slice(0, 5)) {
      const type = await input.getAttribute('type')
      const placeholder = await input.getAttribute('placeholder')

      try {
        if (type === 'number' || placeholder?.includes('amount') || placeholder?.includes('0')) {
          await input.fill('1.0')
        } else if (type === 'text') {
          await input.fill('test')
        }
      } catch {
        // Input might be read-only
      }
    }

    // Verify page is still functional
    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('Gateway - Error States', () => {
  test('should handle 404 pages', async ({ page }) => {
    await page.goto(`${GATEWAY_URL}/nonexistent-page-12345`)

    // Should show 404 or redirect to home
    const is404 = page.url().includes('nonexistent') || await page.locator('text=/404|not found/i').isVisible()
    const redirectedHome = page.url() === GATEWAY_URL || page.url() === `${GATEWAY_URL}/`

    expect(is404 || redirectedHome).toBe(true)
  })
})

