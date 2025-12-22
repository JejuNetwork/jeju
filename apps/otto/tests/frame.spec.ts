/**
 * Otto Frame E2E Tests
 * Tests Farcaster frame functionality
 */

import { expect, test } from '@playwright/test'

const BASE_URL = process.env.OTTO_BASE_URL ?? 'http://localhost:4040'

test.describe('Otto Farcaster Frame', () => {
  test('frame returns valid HTML with meta tags', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/frame`)
    expect(response.ok()).toBeTruthy()

    const html = await response.text()
    expect(html).toContain('fc:frame')
    expect(html).toContain('fc:frame:image')
    expect(html).toContain('fc:frame:button')
  })

  test('frame image endpoint returns SVG', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/frame/img?t=test`)
    expect(response.ok()).toBeTruthy()

    const svg = await response.text()
    expect(svg).toContain('<svg')
  })

  test('frame post endpoint handles button click', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/frame/action`, {
      data: {
        untrustedData: {
          fid: 12345,
          buttonIndex: 1,
          inputText: 'swap 1 ETH to USDC',
        },
        trustedData: {
          messageBytes: '',
        },
      },
    })

    expect(response.ok()).toBeTruthy()
    const html = await response.text()
    expect(html).toContain('fc:frame')
  })
})
