/**
 * Otto Wallet Connection Tests (Synpress)
 * Tests wallet connection and trading flows with MetaMask
 */

import { testWithSynpress } from '@synthetixio/synpress'
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright'
import basicSetup from '../wallet-setup/basic.setup'

const test = testWithSynpress(metaMaskFixtures(basicSetup))
const { expect } = test

const BASE_URL = process.env.OTTO_BASE_URL ?? 'http://localhost:4040'

test.describe('Otto Wallet Connection', () => {
  test('connects wallet via OAuth3 flow', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto('/auth/callback?platform=discord&platformId=123&nonce=test')
    await expect(page.locator('body')).toContainText('Connected')
  })

  test('connects wallet via miniapp', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    await page.goto(`${BASE_URL}/miniapp`)
    await page.waitForTimeout(2000)

    const input = page.locator('#input')
    await input.fill('connect my wallet')
    await page.locator('#send').click()

    await page.waitForTimeout(2000)

    const lastMessage = page.locator('.msg.bot').last()
    await expect(lastMessage).toContainText('connect')
  })

  test('signs authentication message', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    const response = await page.request.get(
      `${BASE_URL}/api/chat/auth/message?address=${address}`,
    )
    const data = await response.json()

    expect(data.message).toBeDefined()
    expect(data.nonce).toBeDefined()
    expect(data.message).toContain(address)
  })

  test('verifies API accessibility', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const response = await page.request.get('/health')
    expect(response.ok()).toBe(true)
  })
})

test.describe('Otto Trading with Wallet', () => {
  test('connected wallet can execute swap', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

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

    const swapResponse = await page.request.post(`${BASE_URL}/api/chat/chat`, {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'swap 0.01 ETH to USDC' },
    })
    const swapData = await swapResponse.json()

    expect(swapData.message.content).toBeDefined()
  })

  test('balance check shows connected wallet balance', async ({
    context,
    page,
    metamaskPage,
    extensionId,
  }) => {
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      {
        data: {
          walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
      },
    )
    const sessionData = await sessionResponse.json()

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
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      {
        data: {
          walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
      },
    )
    const sessionData = await sessionResponse.json()

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
    new MetaMask(context, metamaskPage, basicSetup.walletPassword, extensionId)

    const sessionResponse = await page.request.post(
      `${BASE_URL}/api/chat/session`,
      {
        data: {
          walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
      },
    )
    const sessionData = await sessionResponse.json()

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
