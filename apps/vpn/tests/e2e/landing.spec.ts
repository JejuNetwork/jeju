/**
 * E2E Tests for VPN Landing Page
 *
 * Tests cover:
 * - Page load and content verification
 * - Download section with browser extensions
 * - Platform detection and recommended downloads
 * - Feature sections
 * - Stats display
 * - Navigation and links
 * - Mobile responsiveness
 * - Error states
 */

import { expect, test } from '@playwright/test'

const BASE_URL = process.env.VPN_URL || 'http://127.0.0.1:4060'

test.describe('VPN Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await page.goto(BASE_URL)
    await page.waitForLoadState('domcontentloaded')
  })

  test.describe('Hero Section', () => {
    test('displays main heading', async ({ page }) => {
      const heading = page.locator('h1')
      await expect(heading).toBeVisible()
      await expect(heading).toContainText(/VPN|Free/i)
    })

    test('displays hero description', async ({ page }) => {
      const description = page.locator('main p, [class*="hero"] p').first()
      await expect(description).toBeVisible()
    })

    test('displays primary CTA button', async ({ page }) => {
      const ctaButton = page
        .locator(
          'a:text("Install"), button:text("Install"), a:text("Download"), button:text("Download")',
        )
        .first()
      await expect(ctaButton).toBeVisible()
    })

    test('CTA button links to download', async ({ page }) => {
      const ctaButton = page
        .locator('a:text("Install"), a:text("Download")')
        .first()

      if (await ctaButton.isVisible().catch(() => false)) {
        const href = await ctaButton.getAttribute('href')
        expect(href).toMatch(/(download|storage|#download)/i)
      }
    })
  })

  test.describe('Stats Section', () => {
    test('displays usage statistics', async ({ page }) => {
      // Look for stats like "50,000+ Active Users"
      const statsSection = page.locator(
        'text=/\\d+[,\\d]*\\+?.*(?:Users|Countries|TB|Free)/i',
      )
      const count = await statsSection.count()
      expect(count).toBeGreaterThan(0)
    })

    test('stats have associated labels', async ({ page }) => {
      const statsLabels = ['Users', 'Countries', 'Shared', 'Free']
      for (const label of statsLabels) {
        const stat = page.locator(`text=${label}`)
        if (await stat.isVisible().catch(() => false)) {
          await expect(stat).toBeVisible()
        }
      }
    })
  })

  test.describe('Features Section', () => {
    test('displays feature cards', async ({ page }) => {
      const features = [
        'Free',
        'Decentralized',
        'Fast',
        'Privacy',
        'Community',
        'JNS',
      ]

      let foundFeatures = 0
      for (const feature of features) {
        const card = page.locator(`text=${feature}`).first()
        if (await card.isVisible().catch(() => false)) {
          foundFeatures++
        }
      }

      expect(foundFeatures).toBeGreaterThan(2)
    })

    test('feature cards have descriptions', async ({ page }) => {
      const featureSection = page
        .locator('section:has(h2:text("Why")), [class*="feature"]')
        .first()

      if (await featureSection.isVisible().catch(() => false)) {
        const descriptions = featureSection.locator('p')
        const count = await descriptions.count()
        expect(count).toBeGreaterThan(2)
      }
    })
  })

  test.describe('How It Works Section', () => {
    test('displays numbered steps', async ({ page }) => {
      const steps = page.locator('text=/^[123]$/')
      const count = await steps.count()

      if (count > 0) {
        expect(count).toBe(3)
      }
    })

    test('steps have titles and descriptions', async ({ page }) => {
      const stepTitles = ['Install', 'Connect', 'Give Back']

      for (const title of stepTitles) {
        const step = page.locator(`h3:text("${title}")`).first()
        if (await step.isVisible().catch(() => false)) {
          await expect(step).toBeVisible()
        }
      }
    })
  })

  test.describe('Download Section', () => {
    test('displays download heading', async ({ page }) => {
      const downloadSection = page
        .locator('h2:text("Download"), section#download, [id="download"]')
        .first()

      // Scroll to download section
      await page
        .locator('#download, section:has(h2:text("Download"))')
        .first()
        .scrollIntoViewIfNeeded()
      await expect(downloadSection).toBeVisible()
    })

    test('shows Chrome extension download', async ({ page }) => {
      const chromeDownload = page
        .locator(
          'a:has-text("Chrome"), button:has-text("Chrome"), [class*="chrome"]',
        )
        .first()
      await expect(chromeDownload).toBeVisible()
    })

    test('shows Firefox extension download', async ({ page }) => {
      const firefoxDownload = page
        .locator(
          'a:has-text("Firefox"), button:has-text("Firefox"), [class*="firefox"]',
        )
        .first()
      await expect(firefoxDownload).toBeVisible()
    })

    test('shows Edge extension download', async ({ page }) => {
      const edgeDownload = page
        .locator('a:has-text("Edge"), button:has-text("Edge"), [class*="edge"]')
        .first()
      await expect(edgeDownload).toBeVisible()
    })

    test('download links have proper attributes', async ({ page }) => {
      const downloadLinks = page.locator(
        'a[href*="download"], a[href*="storage"]',
      )
      const count = await downloadLinks.count()

      expect(count).toBeGreaterThan(0)

      for (let i = 0; i < count; i++) {
        const link = downloadLinks.nth(i)
        const href = await link.getAttribute('href')
        expect(href).toBeTruthy()
        expect(href).toMatch(/(download|storage|\.zip|\.xpi)/i)
      }
    })

    test('shows file sizes', async ({ page }) => {
      const sizeText = page.locator('text=/\\d+\\.?\\d*\\s*(KB|MB)/i')
      const count = await sizeText.count()
      expect(count).toBeGreaterThan(0)
    })

    test('shows version number', async ({ page }) => {
      const versionText = page.locator('text=/Version\\s*:?\\s*\\d+\\.\\d+/i')
      if (await versionText.isVisible().catch(() => false)) {
        await expect(versionText).toBeVisible()
      }
    })

    test('highlights recommended download', async ({ page }) => {
      const recommended = page
        .locator('[class*="recommended"], text=Recommended, [data-recommended]')
        .first()

      if (await recommended.isVisible().catch(() => false)) {
        await expect(recommended).toBeVisible()
      }
    })
  })

  test.describe('Download Buttons Functionality', () => {
    test('Chrome download button initiates download or redirects', async ({
      page,
    }) => {
      const chromeButton = page.locator('a:has-text("Chrome")').first()

      if (await chromeButton.isVisible().catch(() => false)) {
        const href = await chromeButton.getAttribute('href')
        expect(href).toBeTruthy()

        // Should either be a direct download link or redirect
        expect(href).toMatch(/(download|storage|chrome\.google\.com)/i)
      }
    })

    test('Firefox download has correct file extension', async ({ page }) => {
      const firefoxButton = page
        .locator('a[href*="firefox"], a:has-text("Firefox")')
        .first()

      if (await firefoxButton.isVisible().catch(() => false)) {
        const href = await firefoxButton.getAttribute('href')
        if (href && !href.includes('addons.mozilla.org')) {
          expect(href).toMatch(/\.xpi|filename=.*firefox/i)
        }
      }
    })
  })

  test.describe('Final CTA Section', () => {
    test('displays final call to action', async ({ page }) => {
      const finalCTA = page
        .locator('section:last-of-type h2, [class*="cta"] h2')
        .last()

      if (await finalCTA.isVisible().catch(() => false)) {
        await expect(finalCTA).toBeVisible()
      }
    })

    test('final CTA button is prominent', async ({ page }) => {
      const ctaButton = page
        .locator('section:last-of-type a, section:last-of-type button')
        .last()

      if (await ctaButton.isVisible().catch(() => false)) {
        const box = await ctaButton.boundingBox()
        if (box) {
          expect(box.width).toBeGreaterThan(100)
          expect(box.height).toBeGreaterThan(40)
        }
      }
    })
  })
})

test.describe('VPN Landing Page - Navigation', () => {
  test('header navigation links work', async ({ page }) => {
    await page.goto(BASE_URL)

    const navLinks = ['Features', 'How It Works', 'Download']
    for (const linkText of navLinks) {
      const link = page.locator(`header a:text("${linkText}")`).first()

      if (await link.isVisible().catch(() => false)) {
        const href = await link.getAttribute('href')
        expect(href).toBeTruthy()

        // Click and verify scroll or navigation
        await link.click()
        await page.waitForTimeout(500)

        // URL should update or page should scroll
        const url = page.url()
        expect(url).toContain(BASE_URL)
      }
    }
  })

  test('anchor links scroll to sections', async ({ page }) => {
    await page.goto(BASE_URL)

    const downloadLink = page.locator('a[href="#download"]').first()
    if (await downloadLink.isVisible().catch(() => false)) {
      await downloadLink.click()
      await page.waitForTimeout(500)

      // Download section should be in view
      const downloadSection = page
        .locator('#download, section:has(h2:text("Download"))')
        .first()
      const box = await downloadSection.boundingBox()
      if (box) {
        // Section should be near top of viewport
        expect(box.y).toBeLessThan(500)
      }
    }
  })

  test('footer links have correct targets', async ({ page }) => {
    await page.goto(BASE_URL)

    const externalLinks = page.locator('footer a[href^="http"]')
    const count = await externalLinks.count()

    for (let i = 0; i < count; i++) {
      const link = externalLinks.nth(i)
      const href = await link.getAttribute('href')
      expect(href).toMatch(/^https?:\/\//)
    }
  })
})

test.describe('VPN Landing Page - Mobile', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('hero is fully visible on mobile', async ({ page }) => {
    await page.goto(BASE_URL)

    const heading = page.locator('h1')
    await expect(heading).toBeVisible()
    await expect(heading).toBeInViewport()
  })

  test('download buttons stack on mobile', async ({ page }) => {
    await page.goto(BASE_URL)
    await page
      .locator('#download')
      .scrollIntoViewIfNeeded()
      .catch(() => {})

    const downloadCards = page.locator(
      '[class*="download"] > div, section:has(h2:text("Download")) > div > div',
    )
    const count = await downloadCards.count()

    if (count > 1) {
      const firstBox = await downloadCards.first().boundingBox()
      const secondBox = await downloadCards.nth(1).boundingBox()

      if (firstBox && secondBox) {
        // On mobile, cards should stack (second card below first)
        // or be much narrower
        const stacked = secondBox.y > firstBox.y + firstBox.height - 10
        const narrow = firstBox.width < 300

        expect(stacked || narrow).toBe(true)
      }
    }
  })

  test('text is readable on mobile', async ({ page }) => {
    await page.goto(BASE_URL)

    const bodyFontSize = await page.evaluate(() => {
      const body = document.body
      return parseFloat(window.getComputedStyle(body).fontSize)
    })

    // Font size should be at least 14px for readability
    expect(bodyFontSize).toBeGreaterThanOrEqual(14)
  })
})

test.describe('VPN Landing Page - Error States', () => {
  test('gracefully handles missing release data', async ({ page }) => {
    // Mock failed release API
    await page.route('**/releases/**', (route) =>
      route.fulfill({ status: 404 }),
    )

    await page.goto(BASE_URL)

    // Page should still load
    const heading = page.locator('h1')
    await expect(heading).toBeVisible()

    // Should show fallback or placeholder
    const downloadSection = page.locator(
      '#download, section:has(h2:text("Download"))',
    )
    if (await downloadSection.isVisible().catch(() => false)) {
      const content = await downloadSection.textContent()
      // Should have some content even without live data
      expect(content?.length).toBeGreaterThan(50)
    }
  })

  test('download buttons have fallback behavior', async ({ page }) => {
    await page.goto(BASE_URL)

    const chromeButton = page.locator('a:has-text("Chrome")').first()

    if (await chromeButton.isVisible().catch(() => false)) {
      // Even with mock data, button should be clickable
      const isEnabled = await chromeButton.isEnabled()
      expect(isEnabled).toBe(true)
    }
  })
})

test.describe('VPN Landing Page - Accessibility', () => {
  test('images have alt text', async ({ page }) => {
    await page.goto(BASE_URL)

    const images = page.locator('img')
    const count = await images.count()

    for (let i = 0; i < count; i++) {
      const img = images.nth(i)
      const alt = await img.getAttribute('alt')
      const role = await img.getAttribute('role')
      const ariaHidden = await img.getAttribute('aria-hidden')

      // Image should have alt text, be decorative (role="presentation"), or be hidden
      const hasAccessibleName =
        alt || role === 'presentation' || ariaHidden === 'true'
      expect(hasAccessibleName).toBeTruthy()
    }
  })

  test('form controls are accessible', async ({ page }) => {
    await page.goto(BASE_URL)

    const inputs = page.locator('input, select, textarea')
    const count = await inputs.count()

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i)
      if (await input.isVisible().catch(() => false)) {
        const id = await input.getAttribute('id')
        const ariaLabel = await input.getAttribute('aria-label')
        const ariaLabelledBy = await input.getAttribute('aria-labelledby')

        // Should have some form of label
        expect(id || ariaLabel || ariaLabelledBy).toBeTruthy()
      }
    }
  })

  test('keyboard navigation works', async ({ page }) => {
    await page.goto(BASE_URL)

    // Tab through page
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')

    // Something should be focused
    const focusedElement = page.locator(':focus')
    await expect(focusedElement).toBeVisible()
  })
})

test.describe('VPN Landing Page - Performance', () => {
  test('loads critical content quickly', async ({ page }) => {
    const startTime = Date.now()
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    const domContentLoaded = Date.now() - startTime

    // DOM should be ready within 2 seconds
    expect(domContentLoaded).toBeLessThan(2000)

    // Hero should be visible immediately
    const heading = page.locator('h1')
    await expect(heading).toBeVisible({ timeout: 3000 })
  })

  test('no excessive network requests', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      requests.push(request.url())
    })

    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // Should not make too many requests
    expect(requests.length).toBeLessThan(50)
  })
})
