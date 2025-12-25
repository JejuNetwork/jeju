/**
 * Otto Auth Tests
 * Tests authentication pages and endpoints
 */

import { expect, test } from '@playwright/test'

test.describe('Auth Connect Page', () => {
  test('loads with wallet button', async ({ request }) => {
    const response = await request.get('/auth/connect')
    expect(response.ok()).toBe(true)

    const html = await response.text()
    expect(html).toContain('Otto')
    expect(html).toContain('Connect Wallet')
  })

  test('includes MetaMask integration', async ({ request }) => {
    const response = await request.get('/auth/connect')
    const html = await response.text()

    expect(html).toContain('window.ethereum')
    expect(html).toContain('eth_requestAccounts')
    expect(html).toContain('personal_sign')
  })
})

test.describe('Auth Callback', () => {
  test('handles missing params', async ({ request }) => {
    const response = await request.get('/auth/callback')
    expect(response.ok()).toBe(true)

    const body = await response.text()
    expect(body).toContain('Failed')
    expect(body).toContain('Missing required parameters')
  })

  test('shows success with valid params', async ({ request }) => {
    const params = new URLSearchParams({
      address: '0x1234567890123456789012345678901234567890',
      signature: '0xabcdef1234567890',
      platform: 'discord',
      platformId: '123456789',
      nonce: '12345678-1234-1234-1234-123456789012',
    })

    const response = await request.get(`/auth/callback?${params.toString()}`)
    expect(response.ok()).toBe(true)

    const body = await response.text()
    expect(body).toContain('Connected')
    expect(body).toContain('0x1234...7890')
  })

  test('validates address format', async ({ request }) => {
    const params = new URLSearchParams({
      address: 'invalid-address',
      signature: '0xabcdef',
      platform: 'discord',
      platformId: '123456789',
      nonce: '12345678-1234-1234-1234-123456789012',
    })

    const response = await request.get(`/auth/callback?${params.toString()}`)
    expect(response.status()).toBe(500)
  })
})

test.describe('Auth Message API', () => {
  test('generates message with nonce', async ({ request }) => {
    const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    const response = await request.get(
      `/api/chat/auth/message?address=${address}`,
    )
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.message).toContain(address)
    expect(data.message).toContain('Sign this message')
    expect(data.message).toContain('Otto')
    expect(data.message).toContain('Nonce')
    expect(data.nonce).toBeDefined()
  })

  test('requires address parameter', async ({ request }) => {
    const response = await request.get('/api/chat/auth/message')
    expect(response.status()).toBe(400)
  })
})
