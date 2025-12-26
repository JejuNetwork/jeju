/**
 * PKCE Utils Tests
 */

import { describe, expect, it } from 'bun:test'
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateNonce,
  generatePKCE,
  generateState,
  PKCEUtils,
} from '../utils/pkce'

describe('PKCE Utils', () => {
  describe('generateCodeVerifier', () => {
    it('should generate a 64-character verifier', () => {
      const verifier = generateCodeVerifier()
      expect(verifier.length).toBe(64)
    })

    it('should generate URL-safe characters', () => {
      const verifier = generateCodeVerifier()
      // URL-safe base64: no +, /, or =
      expect(verifier).not.toContain('+')
      expect(verifier).not.toContain('/')
      expect(verifier).not.toContain('=')
    })

    it('should generate unique verifiers', () => {
      const v1 = generateCodeVerifier()
      const v2 = generateCodeVerifier()
      expect(v1).not.toBe(v2)
    })
  })

  describe('generateCodeChallenge', () => {
    it('should generate a challenge from verifier', async () => {
      const verifier = generateCodeVerifier()
      const challenge = await generateCodeChallenge(verifier)

      expect(challenge.length).toBeGreaterThan(0)
      expect(challenge).not.toBe(verifier)
    })

    it('should generate consistent challenges for same verifier', async () => {
      const verifier =
        'test-verifier-12345678901234567890123456789012345678901234'
      const c1 = await generateCodeChallenge(verifier)
      const c2 = await generateCodeChallenge(verifier)

      expect(c1).toBe(c2)
    })
  })

  describe('generateState', () => {
    it('should generate a 32-character state', () => {
      const state = generateState()
      expect(state.length).toBe(32)
    })

    it('should generate unique states', () => {
      const s1 = generateState()
      const s2 = generateState()
      expect(s1).not.toBe(s2)
    })
  })

  describe('generateNonce', () => {
    it('should generate a 16-character nonce', () => {
      const nonce = generateNonce()
      expect(nonce.length).toBe(16)
    })
  })

  describe('generatePKCE', () => {
    it('should generate complete PKCE params', async () => {
      const params = await generatePKCE()

      expect(params.codeVerifier).toBeDefined()
      expect(params.codeChallenge).toBeDefined()
      expect(params.state).toBeDefined()
      expect(params.nonce).toBeDefined()

      expect(params.codeVerifier.length).toBe(64)
      expect(params.state.length).toBe(32)
      expect(params.nonce.length).toBe(16)
    })
  })

  describe('PKCEUtils', () => {
    it('should validate matching states', () => {
      expect(PKCEUtils.validateState('abc123', 'abc123')).toBe(true)
      expect(PKCEUtils.validateState('abc123', 'xyz789')).toBe(false)
    })
  })
})
