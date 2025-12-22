import { expect, type Page, test } from '@playwright/test'

async function waitForVocs(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForSelector('main, article', {
    state: 'visible',
    timeout: 10000,
  })
}

test.describe('Core Pages', () => {
  test('homepage loads', async ({ page }) => {
    await page.goto('/')
    await waitForVocs(page)
    await expect(page.locator('main, article').first()).toBeVisible()
  })

  test('homepage has navigation', async ({ page }) => {
    await page.goto('/')
    await waitForVocs(page)
    await expect(page.locator('nav, header').first()).toBeVisible()
  })
})

test.describe('Getting Started', () => {
  test('quick start page loads', async ({ page }) => {
    await page.goto('/getting-started/quick-start')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Quick Start/i)
  })

  test('quick start has code blocks', async ({ page }) => {
    await page.goto('/getting-started/quick-start')
    await waitForVocs(page)
    await expect(page.locator('pre, code').first()).toBeVisible()
  })

  test('networks page loads', async ({ page }) => {
    await page.goto('/getting-started/networks')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Networks/i)
  })

  test('configuration page loads', async ({ page }) => {
    await page.goto('/getting-started/configuration')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Configuration/i)
  })
})

test.describe('Learn', () => {
  test('architecture page loads', async ({ page }) => {
    await page.goto('/learn/architecture')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Architecture/i)
  })

  test('concepts page loads', async ({ page }) => {
    await page.goto('/learn/concepts')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Concepts/i)
  })
})

test.describe('Contracts', () => {
  test('contracts overview loads', async ({ page }) => {
    await page.goto('/contracts/overview')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Contracts|Overview/i)
  })

  test('tokens page loads', async ({ page }) => {
    await page.goto('/contracts/tokens')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Token/i)
  })

  test('identity page loads', async ({ page }) => {
    await page.goto('/contracts/identity')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Identity/i)
  })

  test('payments page loads', async ({ page }) => {
    await page.goto('/contracts/payments')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Payment/i)
  })
})

test.describe('Applications', () => {
  test('applications overview loads', async ({ page }) => {
    await page.goto('/applications/overview')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Application|Overview/i)
  })

  test('gateway page loads', async ({ page }) => {
    await page.goto('/applications/gateway')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Gateway/i)
  })

  test('bazaar page loads', async ({ page }) => {
    await page.goto('/applications/bazaar')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Bazaar/i)
  })
})

test.describe('Deployment', () => {
  test('deployment overview loads', async ({ page }) => {
    await page.goto('/deployment/overview')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Deployment|Overview/i)
  })

  test('localnet page loads', async ({ page }) => {
    await page.goto('/deployment/localnet')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Localnet/i)
  })

  test('testnet page loads', async ({ page }) => {
    await page.goto('/deployment/testnet')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Testnet/i)
  })
})

test.describe('API Reference', () => {
  test('rpc page loads', async ({ page }) => {
    await page.goto('/api-reference/rpc')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/RPC/i)
  })

  test('graphql page loads', async ({ page }) => {
    await page.goto('/api-reference/graphql')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/GraphQL/i)
  })

  test('a2a page loads', async ({ page }) => {
    await page.goto('/api-reference/a2a')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/A2A/i)
  })

  test('x402 page loads', async ({ page }) => {
    await page.goto('/api-reference/x402')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/x402/i)
  })
})

test.describe('Guides', () => {
  test('guides overview loads', async ({ page }) => {
    await page.goto('/guides/overview')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Guide|Overview/i)
  })

  test('become xlp guide loads', async ({ page }) => {
    await page.goto('/guides/become-xlp')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/XLP/i)
  })
})

test.describe('Reference', () => {
  test('cli reference loads', async ({ page }) => {
    await page.goto('/reference/cli')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/CLI/i)
  })

  test('addresses reference loads', async ({ page }) => {
    await page.goto('/reference/addresses')
    await waitForVocs(page)
    await expect(page).toHaveTitle(/Address/i)
  })
})

test.describe('Navigation', () => {
  test('sidebar is visible on content pages', async ({ page }) => {
    await page.goto('/getting-started/quick-start')
    await waitForVocs(page)
    await expect(page.locator('aside, nav').first()).toBeVisible()
  })

  test('can navigate via sidebar', async ({ page }) => {
    await page.goto('/getting-started/quick-start')
    await waitForVocs(page)
    await page.click('text=Networks')
    await waitForVocs(page)
    await expect(page).toHaveURL(/networks/)
  })
})

test.describe('Responsive', () => {
  test('mobile viewport renders', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await waitForVocs(page)
    await expect(page.locator('main, article').first()).toBeVisible()
  })

  test('tablet viewport renders', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/')
    await waitForVocs(page)
    await expect(page.locator('main, article').first()).toBeVisible()
  })

  test('desktop viewport renders', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/')
    await waitForVocs(page)
    await expect(page.locator('main, article').first()).toBeVisible()
  })
})

test.describe('Content Quality', () => {
  test('code blocks render', async ({ page }) => {
    await page.goto('/getting-started/quick-start')
    await waitForVocs(page)
    await expect(page.locator('pre, code').first()).toBeVisible()
  })

  test('has internal links', async ({ page }) => {
    await page.goto('/')
    await waitForVocs(page)
    const links = page.locator('a[href^="/"]')
    const count = await links.count()
    expect(count).toBeGreaterThan(0)
  })
})

test.describe('Error Handling', () => {
  test('handles nonexistent route', async ({ page }) => {
    await page.goto('/nonexistent-page-12345')
    await expect(page.locator('body')).toBeVisible()
  })
})
