/**
 * Auth API tests
 */

import { describe, expect, test } from 'bun:test'

const BASE_URL = 'http://localhost:4200'

describe('Auth API', () => {
  test('health check returns healthy', async () => {
    const response = await fetch(`${BASE_URL}/health`)
    expect(response.ok).toBe(true)

    const data = await response.json()
    expect(data.status).toBe('healthy')
    expect(data.service).toBe('auth')
  })

  test('root returns service info', async () => {
    const response = await fetch(BASE_URL)
    expect(response.ok).toBe(true)

    const data = await response.json()
    expect(data.name).toBe('Jeju Auth Gateway')
    expect(data.version).toBe('1.0.0')
    expect(data.endpoints).toBeDefined()
  })

  describe('OAuth endpoints', () => {
    test('authorize requires client_id', async () => {
      const response = await fetch(`${BASE_URL}/oauth/authorize`)
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.error).toBe('invalid_request')
    })

    test('authorize returns HTML page for valid client', async () => {
      const response = await fetch(
        `${BASE_URL}/oauth/authorize?client_id=jeju-default&redirect_uri=http://localhost:3000/callback`,
      )
      expect(response.ok).toBe(true)
      expect(response.headers.get('content-type')).toContain('text/html')
    })

    test('token requires grant_type', async () => {
      const response = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
    })

    test('userinfo requires authentication', async () => {
      const response = await fetch(`${BASE_URL}/oauth/userinfo`)
      expect(response.status).toBe(401)
    })

    test('social provider returns 503 when not configured', async () => {
      const response = await fetch(
        `${BASE_URL}/oauth/social/github?client_id=jeju-default&redirect_uri=http://localhost:3000/callback`,
      )
      // Should return 503 if credentials not set, or redirect if configured
      expect([302, 503]).toContain(response.status)
    })
  })

  describe('Wallet endpoints', () => {
    test('challenge returns HTML page', async () => {
      const response = await fetch(
        `${BASE_URL}/wallet/challenge?client_id=jeju-default&redirect_uri=http://localhost:3000/callback&state=test`,
      )
      expect(response.ok).toBe(true)
      expect(response.headers.get('content-type')).toContain('text/html')

      const html = await response.text()
      expect(html).toContain('Connect Wallet')
    })

    test('verify requires valid challenge', async () => {
      const response = await fetch(`${BASE_URL}/wallet/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: 'invalid',
          address: '0x0000000000000000000000000000000000000000',
          signature: '0x00',
        }),
      })
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.error).toBe('invalid_challenge')
    })
  })

  describe('Farcaster endpoints', () => {
    test('init returns HTML page with QR code', async () => {
      const response = await fetch(
        `${BASE_URL}/farcaster/init?client_id=jeju-default&redirect_uri=http://localhost:3000/callback&state=test`,
      )
      expect(response.ok).toBe(true)
      expect(response.headers.get('content-type')).toContain('text/html')

      const html = await response.text()
      expect(html).toContain('Farcaster')
      expect(html).toContain('data:image/png;base64')
    })

    test('verify requires valid nonce', async () => {
      const response = await fetch(`${BASE_URL}/farcaster/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: 'invalid',
          message: 'test',
          signature: '0x00',
          fid: 1234,
          custody: '0x0000000000000000000000000000000000000000',
        }),
      })
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.error).toBe('invalid_nonce')
    })
  })

  describe('Session endpoints', () => {
    test('session check returns not authenticated without cookie', async () => {
      const response = await fetch(`${BASE_URL}/session`)
      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data.authenticated).toBe(false)
    })

    test('session verify requires token', async () => {
      const response = await fetch(`${BASE_URL}/session/verify`)
      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data.valid).toBe(false)
    })
  })

  describe('Client endpoints', () => {
    test('register validates body schema', async () => {
      const response = await fetch(`${BASE_URL}/client/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test App',
          redirectUris: ['http://localhost:3000/callback'],
          // Missing owner field - Elysia returns validation error
        }),
      })
      // Elysia returns 422 for validation errors
      expect([400, 422]).toContain(response.status)
    })

    test('register succeeds with valid data', async () => {
      const response = await fetch(`${BASE_URL}/client/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test App',
          redirectUris: ['http://localhost:3000/callback'],
          owner: '0x1234567890123456789012345678901234567890',
        }),
      })
      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.clientId).toBeDefined()
      expect(data.clientSecret).toBeDefined()
      expect(data.name).toBe('Test App')
    })

    test('get client info for default client', async () => {
      const response = await fetch(`${BASE_URL}/client/jeju-default`)
      expect(response.ok).toBe(true)

      const data = await response.json()
      expect(data.clientId).toBe('jeju-default')
      expect(data.name).toBe('Jeju Network Apps')
      expect(data.active).toBe(true)
    })

    test('get unknown client returns 404', async () => {
      const response = await fetch(`${BASE_URL}/client/unknown-client`)
      expect(response.status).toBe(404)
    })
  })

  describe('Token refresh flow', () => {
    test('refresh_token grant type is supported', async () => {
      const response = await fetch(`${BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: 'invalid-token',
          client_id: 'jeju-default',
        }),
      })
      expect(response.status).toBe(400)

      const data = await response.json()
      // Should return invalid_grant, not unsupported_grant_type
      expect(data.error).toBe('invalid_grant')
    })
  })
})
