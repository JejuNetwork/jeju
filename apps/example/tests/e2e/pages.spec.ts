import { expect, test } from '@playwright/test'

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4501'
const API_URL = process.env.API_URL || 'http://localhost:4500'

test.describe('Frontend Page Load', () => {
  test('loads the homepage', async ({ page }) => {
    await page.goto(FRONTEND_URL)
    await page.waitForLoadState('domcontentloaded')

    // Page should have the app container
    await expect(page.locator('#app')).toBeVisible()

    // Should show app title
    await expect(page.getByText('Decentralized Todo')).toBeVisible()
  })

  test('shows connect wallet screen when not connected', async ({ page }) => {
    await page.goto(FRONTEND_URL)
    await page.waitForLoadState('domcontentloaded')

    // Should show connect prompt
    await expect(page.getByText('Connect Your Wallet')).toBeVisible()

    // Should have connect button
    await expect(page.locator('#connect')).toBeVisible()
  })

  test('displays correct branding', async ({ page }) => {
    await page.goto(FRONTEND_URL)
    await page.waitForLoadState('domcontentloaded')

    // Should show Jeju Network branding
    await expect(page.getByText(/Powered by Jeju Network/i)).toBeVisible()
    await expect(page.getByText(/CQL.*IPFS.*KMS/i)).toBeVisible()
  })

  test('has proper HTML structure', async ({ page }) => {
    await page.goto(FRONTEND_URL)
    await page.waitForLoadState('domcontentloaded')

    // Check page title
    await expect(page).toHaveTitle(/Decentralized Todo/i)

    // Check main elements exist
    await expect(page.locator('header')).toBeVisible()
    await expect(page.locator('h1')).toBeVisible()
  })

  test('shows error message when no wallet installed', async ({ page }) => {
    await page.goto(FRONTEND_URL)
    await page.waitForLoadState('domcontentloaded')

    // Click connect without wallet extension
    await page.locator('#connect').click()

    // Should show error about wallet
    await expect(
      page.getByText(/Please install MetaMask|Web3 wallet/i),
    ).toBeVisible({ timeout: 5000 })
  })
})

test.describe('API Health Check', () => {
  test('API health endpoint responds', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.status).toBeDefined()
    expect(data.services).toBeInstanceOf(Array)
  })

  test('API root endpoint responds with info', async ({ request }) => {
    const response = await request.get(`${API_URL}/`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.name).toBeDefined()
    expect(data.endpoints).toBeDefined()
    expect(data.endpoints.rest).toBe('/api/v1')
  })

  test('API docs endpoint responds', async ({ request }) => {
    const response = await request.get(`${API_URL}/docs`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.title).toBeDefined()
    expect(data.restEndpoints).toBeDefined()
  })

  test('A2A agent card is available', async ({ request }) => {
    const response = await request.get(
      `${API_URL}/a2a/.well-known/agent-card.json`,
    )
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.protocolVersion).toBeDefined()
    expect(data.name).toBeDefined()
    expect(data.skills).toBeInstanceOf(Array)
    expect(data.skills.length).toBeGreaterThan(0)
  })

  test('x402 info endpoint responds', async ({ request }) => {
    const response = await request.get(`${API_URL}/x402/info`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(typeof data.enabled).toBe('boolean')
  })

  test('REST API rejects unauthenticated requests', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/todos`)
    // Should return 401 or 400 (validation error for missing headers)
    expect([400, 401]).toContain(response.status())
  })
})

test.describe('MCP Protocol', () => {
  test('MCP info endpoint responds', async ({ request }) => {
    const response = await request.get(`${API_URL}/mcp`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.name).toBeDefined()
  })

  test('MCP tools list responds', async ({ request }) => {
    const response = await request.post(`${API_URL}/mcp/tools/list`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.tools).toBeInstanceOf(Array)
    expect(data.tools.length).toBeGreaterThan(0)
  })

  test('MCP resources list responds', async ({ request }) => {
    const response = await request.post(`${API_URL}/mcp/resources/list`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.resources).toBeInstanceOf(Array)
  })
})
