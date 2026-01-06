import { expect, test } from '@playwright/test'

// Use baseURL from playwright config (supports both local and testnet)
// For local: http://localhost:4501 / http://localhost:4500
// For testnet: https://example.testnet.jejunetwork.org

test.describe('Frontend Page Load', () => {
  test('loads the homepage', async ({ page, baseURL }) => {
    await page.goto(baseURL ?? '/')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.locator('#app')).toBeVisible()
    await expect(page.getByText('Jeju Tasks')).toBeVisible()
  })

  test('shows connect wallet screen when not connected', async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL ?? '/')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByText('Connect your wallet')).toBeVisible()
    // The button might have different IDs depending on the build
    const connectBtn = page.locator('button:has-text("Connect")').first()
    await expect(connectBtn).toBeVisible()
  })

  test('displays service badges', async ({ page, baseURL }) => {
    await page.goto(baseURL ?? '/')
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByText('SQLit')).toBeVisible()
    await expect(page.getByText('IPFS')).toBeVisible()
    await expect(page.getByText('KMS')).toBeVisible()
  })

  test('has proper HTML structure', async ({ page, baseURL }) => {
    await page.goto(baseURL ?? '/')
    await page.waitForLoadState('domcontentloaded')

    await expect(page).toHaveTitle(/Jeju Tasks/i)
    await expect(page.locator('header')).toBeVisible()
    await expect(page.locator('h1')).toBeVisible()
  })

  test('shows error message when no wallet installed', async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL ?? '/')
    await page.waitForLoadState('domcontentloaded')

    const connectBtn = page.locator('button:has-text("Connect")').first()
    await connectBtn.click()

    await expect(
      page.getByText(/Wallet not detected|Install MetaMask/i),
    ).toBeVisible({ timeout: 5000 })
  })
})

test.describe('API Health Check', () => {
  test('API health endpoint responds', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/health`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.status).toBeDefined()
    expect(data.services).toBeInstanceOf(Array)
  })

  test('API root endpoint responds with info', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/api/v1`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.name).toBeDefined()
    expect(data.endpoints).toBeDefined()
    expect(data.endpoints.rest).toBe('/api/v1')
  })

  test('API docs endpoint responds', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/api/v1/docs`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.title).toBeDefined()
    expect(data.restEndpoints).toBeDefined()
  })

  test('A2A agent card is available', async ({ request, baseURL }) => {
    const response = await request.get(
      `${baseURL}/a2a/.well-known/agent-card.json`,
    )
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.protocolVersion).toBeDefined()
    expect(data.name).toBeDefined()
    expect(data.skills).toBeInstanceOf(Array)
    expect(data.skills.length).toBeGreaterThan(0)
  })

  test('x402 info endpoint responds', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/x402/info`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(typeof data.enabled).toBe('boolean')
  })

  test('REST API rejects unauthenticated requests', async ({
    request,
    baseURL,
  }) => {
    const response = await request.get(`${baseURL}/api/v1/todos`)
    expect([400, 401]).toContain(response.status())
  })
})

test.describe('MCP Protocol', () => {
  test('MCP info endpoint responds', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/mcp`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.name).toBeDefined()
  })

  test('MCP tools list responds', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/mcp/tools/list`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.tools).toBeInstanceOf(Array)
    expect(data.tools.length).toBeGreaterThan(0)
  })

  test('MCP resources list responds', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/mcp/resources/list`)
    expect(response.status()).toBe(200)

    const data = await response.json()
    expect(data.resources).toBeInstanceOf(Array)
  })
})
