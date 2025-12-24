/**
 * Otto Wallet Connection Tests (Synpress)
 * Tests wallet connection and trading flows with MetaMask
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from './wallet-setup/basic.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const BASE_URL = process.env.OTTO_BASE_URL ?? 'http://localhost:4040'
const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

test.describe('Page Loading with Wallet Extension', () => {
  test('miniapp loads with MetaMask available', async ({ page }) => {
    await page.goto(`${BASE_URL}/miniapp`)
    await page.waitForLoadState('domcontentloaded')

    // Check chat interface
    const chat = page.locator('#chat')
    await expect(chat).toBeVisible()

    // MetaMask should be available
    const hasEthereum = await page.evaluate(() => !!window.ethereum)
    expect(hasEthereum).toBe(true)
  })

  test('auth connect page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/connect`)
    await page.waitForLoadState('domcontentloaded')

    const connectButton = page.locator('button.btn-primary')
    await expect(connectButton).toBeVisible()
    await expect(connectButton).toContainText('Connect Wallet')
  })
})

test.describe('Wallet Connection Flow', () => {
  test('connects wallet via auth page and gets address', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    // Navigate to auth connect page
    await page.goto(`${BASE_URL}/auth/connect`)
    await page.waitForLoadState('domcontentloaded')

    // Click connect button
    await page.locator('button.btn-primary').click()

    // Connect MetaMask
    await metamask.connectToDapp()

    // After connection, check if we got an address
    const address = await page.evaluate(async () => {
      if (!window.ethereum) return null
      const accounts = await window.ethereum.request({
        method: 'eth_accounts',
      })
      return accounts[0] ?? null
    })

    expect(address?.toLowerCase()).toBe(TEST_WALLET.toLowerCase())
  })

  test('auth callback validates signature format', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const params = new URLSearchParams({
      address: TEST_WALLET,
      signature: `0x${'a'.repeat(130)}`,
      platform: 'discord',
      platformId: '123456789',
      nonce: '12345678-1234-1234-1234-123456789012',
    })

    await page.goto(`${BASE_URL}/auth/callback?${params.toString()}`)
    await page.waitForLoadState('domcontentloaded')

    const body = page.locator('body')
    await expect(body).toContainText('Connected')
  })
})

test.describe('Auth Message Flow', () => {
  test('generates auth message for wallet', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const response = await page.request.get(
      `${BASE_URL}/api/chat/auth/message?address=${TEST_WALLET}`,
    )
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.message).toContain(TEST_WALLET)
    expect(data.message).toContain('Otto')
    expect(data.message).toContain('Nonce')
    expect(data.nonce).toBeDefined()
  })

  test('auth message includes timestamp', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const response = await page.request.get(
      `${BASE_URL}/api/chat/auth/message?address=${TEST_WALLET}`,
    )
    const data = await response.json()

    expect(data.message).toContain('Timestamp')
  })
})

test.describe('Connected Wallet Trading Flows', () => {
  test('swap command with connected wallet', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    // Create session with wallet
    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      { data: { walletAddress: TEST_WALLET } },
    )
    const sessionData = await sessionResponse.json()
    const sessionId = sessionData.sessionId

    // Send swap command
    const swapResponse = await page.request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'swap 0.01 ETH to USDC' },
    })
    expect(swapResponse.ok()).toBe(true)

    const swapData = await swapResponse.json()
    expect(swapData.message.content).toBeDefined()
    expect(swapData.requiresAuth).toBe(false)
  })

  test('balance check with connected wallet', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      { data: { walletAddress: TEST_WALLET } },
    )
    const sessionData = await sessionResponse.json()

    const balanceResponse = await page.request.post(
      `${BASE_URL}/api/chat/chat`,
      {
        headers: { 'X-Session-Id': sessionData.sessionId },
        data: { message: 'check my balance' },
      },
    )
    expect(balanceResponse.ok()).toBe(true)

    const balanceData = await balanceResponse.json()
    expect(balanceData.message.content).toBeDefined()
    expect(balanceData.requiresAuth).toBe(false)
  })

  test('bridge command with connected wallet', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      { data: { walletAddress: TEST_WALLET } },
    )
    const sessionData = await sessionResponse.json()

    const bridgeResponse = await page.request.post(
      `${BASE_URL}/api/chat/chat`,
      {
        headers: { 'X-Session-Id': sessionData.sessionId },
        data: { message: 'bridge 0.01 ETH from ethereum to base' },
      },
    )
    expect(bridgeResponse.ok()).toBe(true)

    const bridgeData = await bridgeResponse.json()
    expect(bridgeData.message.content).toBeDefined()
  })

  test('send command with connected wallet', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      { data: { walletAddress: TEST_WALLET } },
    )
    const sessionData = await sessionResponse.json()

    const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    const sendResponse = await page.request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionData.sessionId },
      data: { message: `send 0.01 ETH to ${recipient}` },
    })
    expect(sendResponse.ok()).toBe(true)

    const sendData = await sendResponse.json()
    expect(sendData.message.content).toBeDefined()
  })
})

test.describe('Limit Order Flows with Wallet', () => {
  test('create limit order', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      { data: { walletAddress: TEST_WALLET } },
    )
    const sessionData = await sessionResponse.json()

    const orderResponse = await page.request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionData.sessionId },
      data: { message: 'limit order 1 ETH at 4000 USDC' },
    })
    expect(orderResponse.ok()).toBe(true)

    const orderData = await orderResponse.json()
    expect(orderData.message.content).toBeDefined()
    expect(orderData.requiresAuth).toBe(false)
  })

  test('view orders', async ({ context, page, metamaskPage, extensionId }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      { data: { walletAddress: TEST_WALLET } },
    )
    const sessionData = await sessionResponse.json()

    const ordersResponse = await page.request.post(
      `${BASE_URL}/api/chat/chat`,
      {
        headers: { 'X-Session-Id': sessionData.sessionId },
        data: { message: 'show my orders' },
      },
    )
    expect(ordersResponse.ok()).toBe(true)

    const ordersData = await ordersResponse.json()
    expect(ordersData.message.content).toBeDefined()
  })

  test('cancel order', async ({ context, page, metamaskPage, extensionId }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      { data: { walletAddress: TEST_WALLET } },
    )
    const sessionData = await sessionResponse.json()

    const cancelResponse = await page.request.post(
      `${BASE_URL}/api/chat/chat`,
      {
        headers: { 'X-Session-Id': sessionData.sessionId },
        data: { message: 'cancel order 1' },
      },
    )
    expect(cancelResponse.ok()).toBe(true)

    const cancelData = await cancelResponse.json()
    expect(cancelData.message.content).toBeDefined()
  })
})

test.describe('Portfolio with Wallet', () => {
  test('view portfolio', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      { data: { walletAddress: TEST_WALLET } },
    )
    const sessionData = await sessionResponse.json()

    const portfolioResponse = await page.request.post(
      `${BASE_URL}/api/chat/chat`,
      {
        headers: { 'X-Session-Id': sessionData.sessionId },
        data: { message: 'show my portfolio' },
      },
    )
    expect(portfolioResponse.ok()).toBe(true)

    const portfolioData = await portfolioResponse.json()
    expect(portfolioData.message.content).toBeDefined()
    expect(portfolioData.requiresAuth).toBe(false)
  })

  test('transaction history', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      { data: { walletAddress: TEST_WALLET } },
    )
    const sessionData = await sessionResponse.json()

    const historyResponse = await page.request.post(
      `${BASE_URL}/api/chat/chat`,
      {
        headers: { 'X-Session-Id': sessionData.sessionId },
        data: { message: 'show my transaction history' },
      },
    )
    expect(historyResponse.ok()).toBe(true)

    const historyData = await historyResponse.json()
    expect(historyData.message.content).toBeDefined()
  })
})

test.describe('Miniapp with Wallet', () => {
  test('miniapp chat with wallet context', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto(`${BASE_URL}/miniapp`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // Type and send message
    const input = page.locator('#input')
    await input.fill('hi')
    await page.locator('#send').click()

    await page.waitForTimeout(2000)

    // Check for response
    const botMsg = page.locator('.msg.bot')
    const count = await botMsg.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('miniapp connect wallet prompt', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto(`${BASE_URL}/miniapp`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const input = page.locator('#input')
    await input.fill('swap 1 ETH to USDC')
    await page.locator('#send').click()

    await page.waitForTimeout(2000)

    const botMsg = page.locator('.msg.bot').last()
    const content = await botMsg.textContent()
    // Without wallet connected via the miniapp, it should prompt connection
    expect(content?.toLowerCase()).toMatch(/connect|wallet/i)
  })
})

test.describe('Health Endpoints with Wallet Context', () => {
  test('health endpoint accessible', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const response = await page.request.get(`${BASE_URL}/health`)
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.status).toBe('healthy')
  })

  test('chains endpoint accessible', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const response = await page.request.get(`${BASE_URL}/api/chains`)
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.chains).toBeInstanceOf(Array)
  })
})
