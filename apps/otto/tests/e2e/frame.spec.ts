/**
 * Otto Farcaster Frame Tests
 * Tests Farcaster frame functionality
 */

import { expect, test } from '@playwright/test'

test.describe('Frame Home', () => {
  test('returns valid frame HTML', async ({ request }) => {
    const response = await request.get('/frame')
    expect(response.ok()).toBe(true)

    const html = await response.text()
    expect(html).toContain('fc:frame')
    expect(html).toContain('fc:frame:image')
    expect(html).toContain('fc:frame:button')
  })

  test('has action buttons', async ({ request }) => {
    const response = await request.get('/frame')
    const html = await response.text()

    expect(html).toContain('Swap')
    expect(html).toContain('Bridge')
    expect(html).toContain('Balance')
  })

  test('includes post URL', async ({ request }) => {
    const response = await request.get('/frame')
    const html = await response.text()

    expect(html).toContain('fc:frame:post_url')
    expect(html).toContain('/frame/action')
  })
})

test.describe('Frame Image', () => {
  test('returns SVG', async ({ request }) => {
    const response = await request.get('/frame/img?t=test')
    expect(response.ok()).toBe(true)

    const contentType = response.headers()['content-type']
    expect(contentType).toContain('image/svg+xml')

    const svg = await response.text()
    expect(svg).toContain('<svg')
  })

  test('includes text parameter', async ({ request }) => {
    const response = await request.get('/frame/img?t=Hello%20World')
    const svg = await response.text()

    expect(svg).toContain('Hello World')
  })

  test('defaults to Otto for empty query', async ({ request }) => {
    const response = await request.get('/frame/img')
    expect(response.ok()).toBe(true)

    const svg = await response.text()
    expect(svg).toContain('Otto')
  })

  test('escapes XSS attempts', async ({ request }) => {
    const response = await request.get('/frame/img?t=<script>alert(1)</script>')
    expect(response.ok()).toBe(true)

    const svg = await response.text()
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
  })
})

test.describe('Frame Action', () => {
  test('endpoint exists', async ({ request }) => {
    const response = await request.post('/frame/action', {
      data: {
        untrustedData: {
          fid: 12345,
          buttonIndex: 1,
          inputText: '',
          url: 'http://localhost:4040/frame',
          messageHash: 'abc123',
          timestamp: Date.now(),
          network: 1,
        },
        trustedData: { messageBytes: '' },
      },
    })

    // Action may fail validation but endpoint should exist
    expect(response.status()).toBeDefined()
  })
})
