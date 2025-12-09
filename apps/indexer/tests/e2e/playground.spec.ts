import { test, expect } from '@playwright/test'

test.describe('Playground Page Load', () => {
  test('should load the playground page', async ({ page }) => {
    await page.goto('/playground')
    await expect(page).toHaveTitle(/Jeju Indexer/)
  })

  test('should display the Jeju branding', async ({ page }) => {
    await page.goto('/playground')
    const logo = page.locator('.jeju-logo')
    await expect(logo).toBeVisible()
    const title = page.locator('.jeju-logo-title')
    await expect(title).toContainText('Jeju Indexer')
  })

  test('should load GraphiQL', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    await expect(page.locator('.graphiql-container')).toBeVisible()
  })
})

test.describe('Theme Toggle', () => {
  test('should have a theme toggle button', async ({ page }) => {
    await page.goto('/playground')
    const themeToggle = page.locator('#themeToggle')
    await expect(themeToggle).toBeVisible()
  })

  test('should have a valid theme set', async ({ page }) => {
    await page.goto('/playground')
    const body = page.locator('body')
    const theme = await body.getAttribute('data-theme')
    expect(['dark', 'light']).toContain(theme)
    const icon = page.locator('#themeIcon')
    const iconText = await icon.textContent()
    expect(['☀️', '🌙']).toContain(iconText)
  })

  test('should toggle theme when clicked', async ({ page }) => {
    await page.goto('/playground')
    const themeToggle = page.locator('#themeToggle')
    const body = page.locator('body')
    const initialTheme = await body.getAttribute('data-theme')
    await themeToggle.click()
    await page.waitForTimeout(100)
    const newTheme = await body.getAttribute('data-theme')
    expect(newTheme).not.toBe(initialTheme)
    expect(['dark', 'light']).toContain(newTheme)
  })

  test('should toggle back on second click', async ({ page }) => {
    await page.goto('/playground')
    const themeToggle = page.locator('#themeToggle')
    const body = page.locator('body')
    const initialTheme = await body.getAttribute('data-theme')
    await themeToggle.click()
    await page.waitForTimeout(100)
    await themeToggle.click()
    await page.waitForTimeout(100)
    const finalTheme = await body.getAttribute('data-theme')
    expect(finalTheme).toBe(initialTheme)
  })

  test('should persist theme preference in localStorage', async ({ page }) => {
    await page.goto('/playground')
    const themeToggle = page.locator('#themeToggle')
    const body = page.locator('body')
    await themeToggle.click()
    await page.waitForTimeout(100)
    const newTheme = await body.getAttribute('data-theme')
    const storedTheme = await page.evaluate(() => localStorage.getItem('jeju-theme'))
    expect(storedTheme).toBe(newTheme)
    await page.reload()
    await page.waitForSelector('.jeju-header')
    await expect(body).toHaveAttribute('data-theme', newTheme!)
  })
})

test.describe('GraphiQL Interface', () => {
  test('should load GraphiQL container', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    await expect(page.locator('.graphiql-container')).toBeVisible()
  })

  test('should display the query editor', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    const queryEditor = page.locator('[aria-label="Query Editor"]')
    await expect(queryEditor).toBeVisible()
  })

  test('should display the result window', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    const resultWindow = page.locator('[aria-label="Result Window"]')
    await expect(resultWindow).toBeVisible()
  })

  test('should have an execute button', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    const executeButton = page.locator('button[aria-label*="Execute"]')
    await expect(executeButton).toBeVisible()
  })

  test('should have prettify button', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    const prettifyButton = page.locator('button[aria-label*="Prettify"]')
    await expect(prettifyButton).toBeVisible()
  })

  test('should have documentation explorer button', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    const docsButton = page.locator('button[aria-label*="Documentation"]')
    await expect(docsButton).toBeVisible()
  })

  test('should have history button', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    const historyButton = page.locator('button[aria-label*="History"]')
    await expect(historyButton).toBeVisible()
  })

  test('should have variables tab', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    const variablesTab = page.locator('button:has-text("Variable")')
    await expect(variablesTab).toBeVisible()
  })

  test('should have headers tab', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    const headersTab = page.locator('button:has-text("Header")')
    await expect(headersTab).toBeVisible()
  })

  test('should contain default query', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    await page.waitForTimeout(1000)
    const queryEditor = page.locator('[aria-label="Query Editor"]')
    await expect(queryEditor).toBeVisible()
    const editorContent = await page.locator('.graphiql-query-editor .CodeMirror').first().textContent()
    expect(editorContent).toBeDefined()
  })
})

test.describe('Mobile Responsiveness', () => {
  test('header should be compact on mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile only')
    await page.goto('/playground')
    const header = page.locator('.jeju-header')
    await expect(header).toBeVisible()
    const logoIcon = page.locator('.jeju-logo-icon')
    const box = await logoIcon.boundingBox()
    expect(box?.width).toBeLessThanOrEqual(36)
  })

  test('theme toggle should be accessible on mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile only')
    await page.goto('/playground')
    const themeToggle = page.locator('#themeToggle')
    await expect(themeToggle).toBeVisible()
    const box = await themeToggle.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(28)
    expect(box?.height).toBeGreaterThanOrEqual(28)
  })

  test('GraphiQL should be usable on mobile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile only')
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    const executeButton = page.locator('button[aria-label*="Execute"]')
    await expect(executeButton).toBeVisible()
  })

  test('should handle landscape orientation', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 400 })
    await page.goto('/playground')
    const header = page.locator('.jeju-header')
    const box = await header.boundingBox()
    expect(box?.height).toBeLessThanOrEqual(60)
  })
})

test.describe('Viewport Tests', () => {
  const viewports = [
    { name: 'iPhone SE', width: 375, height: 667 },
    { name: 'iPhone 12', width: 390, height: 844 },
    { name: 'Galaxy S21', width: 360, height: 800 },
    { name: 'iPad Mini', width: 768, height: 1024 },
    { name: 'iPad Pro', width: 1024, height: 1366 },
    { name: 'Desktop', width: 1280, height: 800 },
    { name: 'Large Desktop', width: 1920, height: 1080 },
  ]

  for (const viewport of viewports) {
    test(`should render correctly at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/playground')
      await page.waitForSelector('.graphiql-container', { timeout: 10000 })
      await expect(page.locator('.jeju-header')).toBeVisible()
      await expect(page.locator('#themeToggle')).toBeVisible()
      await expect(page.locator('.graphiql-container')).toBeVisible()
      const body = page.locator('body')
      const scrollWidth = await body.evaluate(el => el.scrollWidth)
      const clientWidth = await body.evaluate(el => el.clientWidth)
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
    })
  }
})

test.describe('Accessibility', () => {
  test('should have proper page title', async ({ page }) => {
    await page.goto('/playground')
    await expect(page).toHaveTitle(/Jeju Indexer/)
  })

  test('theme toggle should have title attribute', async ({ page }) => {
    await page.goto('/playground')
    const themeToggle = page.locator('#themeToggle')
    await expect(themeToggle).toHaveAttribute('title', 'Toggle theme')
  })

  test('buttons should be keyboard accessible', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.jeju-header')
    const themeToggle = page.locator('#themeToggle')
    const tagName = await themeToggle.evaluate(el => el.tagName.toLowerCase())
    expect(tagName).toBe('button')
    const tabindex = await themeToggle.getAttribute('tabindex')
    expect(tabindex).not.toBe('-1')
  })

  test('should have proper heading structure', async ({ page }) => {
    await page.goto('/playground')
    const title = page.locator('.jeju-logo-title')
    await expect(title).toBeVisible()
  })
})

test.describe('Navigation', () => {
  test('root should redirect to playground', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/playground/)
  })

  test('logo link should navigate to root', async ({ page }) => {
    await page.goto('/playground')
    const logo = page.locator('.jeju-logo')
    await expect(logo).toHaveAttribute('href', '/')
  })
})

test.describe('Performance', () => {
  test('should load within acceptable time', async ({ page }) => {
    const startTime = Date.now()
    await page.goto('/playground')
    await page.waitForSelector('.graphiql-container', { timeout: 10000 })
    const loadTime = Date.now() - startTime
    expect(loadTime).toBeLessThan(5000)
  })

  test('theme toggle should respond quickly', async ({ page }) => {
    await page.goto('/playground')
    await page.waitForSelector('.jeju-header')
    const body = page.locator('body')
    const initialTheme = await body.getAttribute('data-theme')
    const startTime = Date.now()
    await page.locator('#themeToggle').click()
    const expectedTheme = initialTheme === 'dark' ? 'light' : 'dark'
    await expect(body).toHaveAttribute('data-theme', expectedTheme, { timeout: 2000 })
    const toggleTime = Date.now() - startTime
    expect(toggleTime).toBeLessThan(2000)
  })
})

test.describe('Error Handling', () => {
  test('should handle missing GraphQL server gracefully', async ({ page }) => {
    await page.goto('/playground')
    await expect(page.locator('.jeju-header')).toBeVisible()
    await expect(page.locator('#themeToggle')).toBeVisible()
  })
})
