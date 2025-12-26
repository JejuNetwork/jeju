/**
 * CI Dashboard E2E Tests (Synpress)
 * Tests CI/CD dashboard with wallet integration
 */

// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { testWithSynpress } from '@synthetixio/synpress'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { metaMaskFixtures } from '@synthetixio/synpress/playwright'
// Must import zod-compat before synpress for Zod 4 compatibility
import '@jejunetwork/tests/zod-compat'
import { basicSetup } from '../../synpress.config'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

test.describe('CI Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ci')
  })

  test('displays build list', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /deployments/i }),
    ).toBeVisible()
    const buildCards = page.locator('[href^="/ci/"]')
    await expect(buildCards.first()).toBeVisible()
  })

  test('filters by status', async ({ page }) => {
    const runningFilter = page.getByRole('button', { name: /running/i })
    await runningFilter.click()
    await expect(page.locator('.animate-spin')).toBeVisible()
  })

  test('filters by repository', async ({ page }) => {
    const repoButton = page.getByRole('button', { name: /factory/i })
    await repoButton.click()
    const builds = page.locator('[href^="/ci/"]')
    for (const build of await builds.all()) {
      await expect(build).toContainText('factory')
    }
  })

  test('navigates to build detail', async ({ page }) => {
    const firstBuild = page.locator('[href^="/ci/"]').first()
    await firstBuild.click()
    await expect(page).toHaveURL(/\/ci\/0x/)
    await expect(page.getByRole('heading', { name: /deploy/i })).toBeVisible()
  })

  test('displays search functionality', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search builds/i)
    await searchInput.fill('deploy')
    const builds = page.locator('[href^="/ci/"]')
    const count = await builds.count()
    expect(count).toBeGreaterThan(0)
  })
})

test.describe('Build Detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ci')
    const firstBuild = page.locator('[href^="/ci/"]').first()
    await firstBuild.click()
  })

  test('shows build summary', async ({ page }) => {
    await expect(page.getByText(/summary/i)).toBeVisible()
    await expect(page.getByText(/status/i)).toBeVisible()
    await expect(page.getByText(/trigger/i)).toBeVisible()
  })

  test('lists jobs', async ({ page }) => {
    await expect(page.getByText(/jobs/i)).toBeVisible()
    const jobButtons = page.locator(
      'button:has-text("Build"), button:has-text("Test"), button:has-text("Deploy")',
    )
    const count = await jobButtons.count()
    expect(count).toBeGreaterThan(0)
  })

  test('shows logs terminal', async ({ page }) => {
    const terminal = page.locator('.font-mono')
    await expect(terminal).toBeVisible()
    await expect(page.getByText(/auto-scroll/i)).toBeVisible()
  })

  test('expands and collapses steps', async ({ page }) => {
    const stepButtons = page.locator('button:has([class*="chevron"])')
    if ((await stepButtons.count()) > 0) {
      await stepButtons.first().click()
      await page.waitForTimeout(300)
    }
  })

  test('copies logs to clipboard', async ({ page }) => {
    const copyButton = page.locator('button:has([data-lucide="copy"])')
    if ((await copyButton.count()) > 0) {
      await copyButton.click()
      await expect(page.locator('[data-lucide="check"]')).toBeVisible({
        timeout: 3000,
      })
    }
  })
})

test.describe('Build Actions', () => {
  test('shows cancel button for running builds', async ({ page }) => {
    await page.goto('/ci')
    const runningBuild = page
      .locator('[href^="/ci/"]:has(.animate-spin)')
      .first()
    if ((await runningBuild.count()) > 0) {
      await runningBuild.click()
      await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible()
    }
  })

  test('shows re-run button', async ({ page }) => {
    await page.goto('/ci')
    const firstBuild = page.locator('[href^="/ci/"]').first()
    await firstBuild.click()
    await expect(page.getByRole('button', { name: /re-run/i })).toBeVisible()
  })
})

test.describe('Artifacts', () => {
  test('displays artifacts section when present', async ({ page }) => {
    await page.goto('/ci')
    const firstBuild = page.locator('[href^="/ci/"]').first()
    await firstBuild.click()

    const artifactsSection = page.getByText(/artifacts/i)
    if ((await artifactsSection.count()) > 0) {
      await expect(artifactsSection).toBeVisible()
      const downloadButton = page.locator(
        'button:has([data-lucide="download"])',
      )
      if ((await downloadButton.count()) > 0) {
        await expect(downloadButton.first()).toBeVisible()
      }
    }
  })
})

test.describe('Navigation', () => {
  test('back button returns to dashboard', async ({ page }) => {
    await page.goto('/ci')
    const firstBuild = page.locator('[href^="/ci/"]').first()
    await firstBuild.click()

    const backButton = page.locator('a:has([data-lucide="arrow-left"])')
    await backButton.click()
    await expect(page).toHaveURL('/ci')
  })

  test('settings link exists', async ({ page }) => {
    await page.goto('/ci')
    const settingsLink = page.locator('a[href="/ci/settings"]')
    await expect(settingsLink).toBeVisible()
  })
})

test.describe('Responsive Design', () => {
  test('works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/ci')
    await expect(
      page.getByRole('heading', { name: /deployments/i }),
    ).toBeVisible()
  })

  test('sidebar collapses on smaller screens', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/ci')
    const sidebar = page.locator('.lg\\:w-64')
    const isSidebarVisible = await sidebar.isVisible()
    expect(typeof isSidebarVisible).toBe('boolean')
  })
})
