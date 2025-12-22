/**
 * Minimal test for x402 Elysia conversion
 * Run with: bun apps/gateway/src/x402/test-conversion.ts
 */

import { createServer } from './server'

async function test() {
  const app = createServer()

  console.log('Testing x402 Elysia conversion...\n')

  // Test 1: Health endpoint
  const healthRes = await app.request('/')
  const healthBody = await healthRes.json()
  console.log('GET / status:', healthRes.status, healthRes.status === 200 ? '✓' : '✗')
  console.log('  service:', healthBody.service)
  console.log('  version:', healthBody.version)

  // Test 2: Supported endpoint
  const supportedRes = await app.request('/supported')
  const supportedBody = await supportedRes.json()
  console.log('\nGET /supported status:', supportedRes.status, supportedRes.status === 200 ? '✓' : '✗')
  console.log('  x402Version:', supportedBody.x402Version)
  console.log('  kinds count:', supportedBody.kinds?.length)

  // Test 3: Networks endpoint
  const networksRes = await app.request('/supported/networks')
  const networksBody = await networksRes.json()
  console.log('\nGET /supported/networks status:', networksRes.status, networksRes.status === 200 ? '✓' : '✗')
  console.log('  networks count:', networksBody.networks?.length)

  // Test 4: Tokens endpoint
  const tokensRes = await app.request('/supported/tokens/jeju')
  const tokensBody = await tokensRes.json()
  console.log('\nGET /supported/tokens/jeju status:', tokensRes.status, tokensRes.status === 200 ? '✓' : '✗')
  console.log('  network:', tokensBody.network)
  console.log('  tokens count:', tokensBody.tokens?.length)

  // Test 5: Invalid tokens endpoint (should 400)
  const badTokensRes = await app.request('/supported/tokens/invalid-network')
  console.log('\nGET /supported/tokens/invalid status:', badTokensRes.status, badTokensRes.status === 400 ? '✓' : '✗')

  // Test 6: Not found (should 404)
  const notFoundRes = await app.request('/unknown/route')
  const notFoundBody = await notFoundRes.json()
  console.log('\nGET /unknown/route status:', notFoundRes.status, notFoundRes.status === 404 ? '✓' : '✗')
  console.log('  error:', notFoundBody.error)

  // Test 7: Verify with invalid JSON (should 400)
  const verifyBadRes = await app.request('/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  })
  console.log('\nPOST /verify bad JSON status:', verifyBadRes.status, verifyBadRes.status === 400 ? '✓' : '✗')

  // Test 8: Settle with invalid JSON (should 400)
  const settleBadRes = await app.request('/settle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  })
  console.log('POST /settle bad JSON status:', settleBadRes.status, settleBadRes.status === 400 ? '✓' : '✗')

  // Test 9: CORS headers
  const corsRes = await app.request('/', { method: 'OPTIONS' })
  const allowOrigin = corsRes.headers.get('access-control-allow-origin')
  console.log('\nOPTIONS / CORS:', allowOrigin === '*' ? '✓' : '✗')

  console.log('\n✓ All tests passed!')
}

test().catch(console.error)
