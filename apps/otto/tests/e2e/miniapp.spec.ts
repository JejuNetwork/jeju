/**
 * Otto Miniapp Tests
 * Tests miniapp pages for web, Telegram, and Farcaster
 */

import { expect, test } from '@playwright/test'

test.describe('Web Miniapp', () => {
  test('loads chat interface HTML', async ({ request }) => {
    const response = await request.get('/miniapp')
    expect(response.ok()).toBe(true)

    const html = await response.text()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('id="chat"')
    expect(html).toContain('id="input"')
    expect(html).toContain('id="send"')
  })

  test('has correct placeholder', async ({ request }) => {
    const response = await request.get('/miniapp')
    const html = await response.text()

    expect(html).toContain('swap 1 ETH to USDC')
  })

  test('includes proper styling', async ({ request }) => {
    const response = await request.get('/miniapp')
    const html = await response.text()

    expect(html).toContain('<style>')
    expect(html).toContain('.msg')
    expect(html).toContain('.user')
    expect(html).toContain('.bot')
  })

  test('includes chat JavaScript', async ({ request }) => {
    const response = await request.get('/miniapp')
    const html = await response.text()

    expect(html).toContain('<script>')
    expect(html).toContain('/api/chat')
    expect(html).toContain('sendMsg')
  })

  test('trailing slash works', async ({ request }) => {
    const response = await request.get('/miniapp/')
    expect(response.ok()).toBe(true)
  })
})

test.describe('Telegram Miniapp', () => {
  test('includes Telegram WebApp script', async ({ request }) => {
    const response = await request.get('/miniapp/telegram')
    expect(response.ok()).toBe(true)

    const html = await response.text()
    expect(html).toContain('telegram-web-app.js')
  })

  test('has Telegram initialization', async ({ request }) => {
    const response = await request.get('/miniapp/telegram')
    const html = await response.text()

    expect(html).toContain('Telegram.WebApp')
    expect(html).toContain('ready()')
    expect(html).toContain('expand()')
  })

  test('has chat interface', async ({ request }) => {
    const response = await request.get('/miniapp/telegram')
    const html = await response.text()

    expect(html).toContain('id="chat"')
    expect(html).toContain('id="input"')
  })
})

test.describe('Farcaster Miniapp', () => {
  test('loads miniapp', async ({ request }) => {
    const response = await request.get('/miniapp/farcaster')
    expect(response.ok()).toBe(true)

    const html = await response.text()
    expect(html).toContain('Otto')
    expect(html).toContain('id="chat"')
  })

  test('has chat interface', async ({ request }) => {
    const response = await request.get('/miniapp/farcaster')
    const html = await response.text()

    expect(html).toContain('id="input"')
    expect(html).toContain('id="send"')
  })
})

test.describe('Root Redirect', () => {
  test('root page loads', async ({ request }) => {
    const response = await request.get('/')
    expect(response.ok()).toBe(true)
  })
})
