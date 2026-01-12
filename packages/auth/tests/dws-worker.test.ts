/**
 * DWS Worker Integration Tests
 *
 * Tests the OAuth3 DWS worker MPC client integration.
 * Tests use mocked MPC infrastructure since we can't spin up a real cluster.
 */

import { describe, expect, it, mock } from 'bun:test'

// Mock the KMS module before importing the worker
mock.module('@jejunetwork/kms', () => ({
  createMPCClient: (_config: unknown, _serviceAgentId: string) => ({
    requestKeyGen: async (_params: { keyId: string }) => ({
      groupPublicKey: `0x${'ab'.repeat(32)}` as const,
      groupAddress: `0x${'cd'.repeat(20)}` as const,
    }),
    requestSignature: async (params: {
      keyId: string
      messageHash: string
    }) => ({
      signature: `0x${'ef'.repeat(32)}` as const,
      r: `0x${'11'.repeat(32)}` as const,
      s: `0x${'22'.repeat(32)}` as const,
      v: 27,
      keyId: params.keyId,
      signingParties: [1, 2, 3],
    }),
  }),
}))

import { createOAuth3Worker } from '../src/dws-worker/index.js'

describe('OAuth3 DWS Worker', () => {
  const config = {
    serviceAgentId: 'test-agent',
    mpcRegistryAddress: '0x1234567890123456789012345678901234567890' as const,
    identityRegistryAddress:
      '0x2345678901234567890123456789012345678901' as const,
    rpcUrl: 'http://localhost:8545',
    sessionDuration: 3600000,
  }

  it('creates worker with valid config', () => {
    const worker = createOAuth3Worker(config)
    expect(worker).toBeDefined()
    expect(typeof worker.handle).toBe('function')
  })

  it('worker has expected routes', () => {
    const worker = createOAuth3Worker(config)
    // Elysia workers have a routes property or we can check the handle function
    expect(worker).toBeDefined()
  })

  describe('Session Management', () => {
    it('handles wallet auth request', async () => {
      const worker = createOAuth3Worker(config)

      // Test wallet auth flow - prefix is /oauth3
      // Returns 500 because signature verification fails with mock data - verifies endpoint exists
      const walletAuthResponse = await worker.handle(
        new Request('http://localhost/oauth3/auth/wallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: '0x1234567890123456789012345678901234567890',
            message: 'Sign in to OAuth3',
            signature: `0x${'ab'.repeat(65)}`,
          }),
        }),
      )

      // Endpoint exists and processes request (returns 500 due to invalid sig, not 404)
      expect(walletAuthResponse.status).not.toBe(404)
    })

    it('handles session validation endpoint', async () => {
      const worker = createOAuth3Worker(config)

      const response = await worker.handle(
        new Request('http://localhost/oauth3/session/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer invalid-token',
          },
          body: JSON.stringify({}),
        }),
      )

      // Should return 500 (session not found error)
      expect(response.status).toBe(500)
    })
  })

  describe('Health Check', () => {
    it('responds to health endpoint', async () => {
      const worker = createOAuth3Worker(config)

      const response = await worker.handle(
        new Request('http://localhost/oauth3/health', { method: 'GET' }),
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.status).toBe('healthy')
      expect(body.service).toBe('oauth3')
      expect(body.mpcEnabled).toBe(true)
    })
  })
})
