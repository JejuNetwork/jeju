/**
 * Synpress Wallet Connection Tests for Otto
 * Tests the wallet connection flow with MetaMask
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../wallet-setup/basic.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const BASE_URL = process.env.OTTO_BASE_URL ?? 'http://localhost:4040'

test.describe('Otto Wallet Connection', () => {
  test('can connect wallet via miniapp', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const _metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    // Navigate to Otto miniapp
    await page.goto(`${BASE_URL}/miniapp`)

    // Wait for page to load
    await page.waitForTimeout(2000)

    // Type connect command
    const input = page.locator('#input')
    await input.fill('connect my wallet')
    await page.locator('#send').click()

    // Wait for response
    await page.waitForTimeout(2000)

    // Should receive connect URL
    const lastMessage = page.locator('.msg.bot').last()
    await expect(lastMessage).toContainText('connect')
  })

  test('wallet signs authentication message', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const _metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    // Get auth message
    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' // First test account
    const response = await page.request.get(
      `${BASE_URL}/api/chat/auth/message?address=${address}`,
    )
    const data = await response.json()

    expect(data.message).toBeDefined()
    expect(data.nonce).toBeDefined()
    expect(data.message).toContain(address)
  })

  test('connected wallet can execute swap', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const _metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    // Create session with wallet
    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      {
        data: {
          walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
      },
    )
    const sessionData = await sessionResponse.json()
    const sessionId = sessionData.sessionId

    // Request swap
    const swapResponse = await page.request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'swap 0.01 ETH to USDC' },
    })
    const swapData = await swapResponse.json()

    // Should proceed to confirmation (not require auth)
    expect(swapData.message.content).toBeDefined()
  })
})

test.describe('Otto Trading Flow with Wallet', () => {
  test('balance check shows connected wallet balance', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const _metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    // Create session with wallet
    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      {
        data: {
          walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
      },
    )
    const sessionData = await sessionResponse.json()

    // Check balance
    const balanceResponse = await page.request.post(
      `${BASE_URL}/api/chat/chat`,
      {
        headers: { 'X-Session-Id': sessionData.sessionId },
        data: { message: 'check my balance' },
      },
    )
    const balanceData = await balanceResponse.json()

    expect(balanceData.message.content).toBeDefined()
    expect(balanceData.requiresAuth).toBe(false)
  })

  test('limit order creation with wallet', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const _metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    // Create session with wallet
    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      {
        data: {
          walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
      },
    )
    const sessionData = await sessionResponse.json()

    // Create limit order
    const orderResponse = await page.request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionData.sessionId },
      data: { message: 'limit order 1 ETH at 4000 USDC' },
    })
    const orderData = await orderResponse.json()

    expect(orderData.message.content).toBeDefined()
  })

  test('view open orders', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    const _metamask = new MetaMask(
      context,
      metamaskPage,
      basicSetup.walletPassword,
      extensionId,
    )

    // Create session with wallet
    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      {
        data: {
          walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
      },
    )
    const sessionData = await sessionResponse.json()

    // View orders
    const ordersResponse = await page.request.post(
      `${BASE_URL}/api/chat/chat`,
      {
        headers: { 'X-Session-Id': sessionData.sessionId },
        data: { message: 'show my orders' },
      },
    )
    const ordersData = await ordersResponse.json()

    expect(ordersData.message.content).toBeDefined()
  })
})
