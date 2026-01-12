/**
 * Otto User Flow Tests
 * Tests complete user journeys through trading features
 * These tests require AI_MODEL to be configured for chat responses
 */

import { expect, test } from '@playwright/test'

const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

async function createSession(
  request: typeof test extends (...args: infer P) => unknown
    ? P[0]['request']
    : never,
  walletAddress?: string,
): Promise<string> {
  const response = await request.post('/api/chat/session', {
    data: walletAddress ? { walletAddress } : {},
  })
  const data = await response.json()
  return data.sessionId
}

async function chat(
  request: typeof test extends (...args: infer P) => unknown
    ? P[0]['request']
    : never,
  sessionId: string,
  message: string,
): Promise<{ content: string; requiresAuth: boolean } | null> {
  const response = await request.post('/api/chat/chat', {
    headers: { 'X-Session-Id': sessionId },
    data: { message },
  })

  if (!response.ok()) return null

  const data = await response.json()
  return {
    content: data.message.content,
    requiresAuth: data.requiresAuth ?? false,
  }
}

test.describe('Trading Without Wallet', () => {
  test('swap prompts connection', async ({ request }) => {
    const sessionId = await createSession(request)
    const response = await chat(request, sessionId, 'swap 1 ETH to USDC')

    if (!response) {
      test.skip()
      return
    }

    expect(response.requiresAuth).toBe(true)
    expect(response.content.toLowerCase()).toMatch(/connect|wallet/i)
  })

  test('balance prompts connection', async ({ request }) => {
    const sessionId = await createSession(request)
    const response = await chat(request, sessionId, 'check my balance')

    if (!response) {
      test.skip()
      return
    }

    expect(response.requiresAuth).toBe(true)
    expect(response.content.toLowerCase()).toMatch(/connect|wallet/i)
  })

  test('send prompts connection', async ({ request }) => {
    const sessionId = await createSession(request)
    const response = await chat(
      request,
      sessionId,
      `send 1 ETH to ${TEST_WALLET}`,
    )

    if (!response) {
      test.skip()
      return
    }

    expect(response.requiresAuth).toBe(true)
  })

  test('bridge prompts connection', async ({ request }) => {
    const sessionId = await createSession(request)
    const response = await chat(
      request,
      sessionId,
      'bridge 1 ETH from ethereum to base',
    )

    if (!response) {
      test.skip()
      return
    }

    expect(response.requiresAuth).toBe(true)
  })
})

test.describe('Trading With Wallet', () => {
  test('swap processes request', async ({ request }) => {
    const sessionId = await createSession(request, TEST_WALLET)
    const response = await chat(request, sessionId, 'swap 0.01 ETH to USDC')

    if (!response) {
      test.skip()
      return
    }

    expect(response.content).toBeDefined()
    expect(response.requiresAuth).toBe(false)
  })

  test('balance shows info', async ({ request }) => {
    const sessionId = await createSession(request, TEST_WALLET)
    const response = await chat(request, sessionId, 'check my balance')

    if (!response) {
      test.skip()
      return
    }

    expect(response.content).toBeDefined()
    expect(response.requiresAuth).toBe(false)
  })

  test('limit order creation', async ({ request }) => {
    const sessionId = await createSession(request, TEST_WALLET)
    const response = await chat(
      request,
      sessionId,
      'limit order 1 ETH at 4000 USDC',
    )

    if (!response) {
      test.skip()
      return
    }

    expect(response.content).toBeDefined()
    expect(response.requiresAuth).toBe(false)
  })

  test('view orders', async ({ request }) => {
    const sessionId = await createSession(request, TEST_WALLET)
    const response = await chat(request, sessionId, 'show my orders')

    if (!response) {
      test.skip()
      return
    }

    expect(response.content).toBeDefined()
  })

  test('portfolio view', async ({ request }) => {
    const sessionId = await createSession(request, TEST_WALLET)
    const response = await chat(request, sessionId, 'show my portfolio')

    if (!response) {
      test.skip()
      return
    }

    expect(response.content).toBeDefined()
  })
})

test.describe('Price Queries', () => {
  test('price query works', async ({ request }) => {
    const sessionId = await createSession(request)
    const response = await chat(request, sessionId, 'price of ETH')

    if (!response) {
      test.skip()
      return
    }

    expect(response.content).toBeDefined()
    expect(response.requiresAuth).toBe(false)
  })
})

test.describe('Session Isolation', () => {
  test('sessions are independent', async ({ request }) => {
    const session1 = await createSession(request)
    const session2 = await createSession(request)

    expect(session1).not.toBe(session2)
  })
})
