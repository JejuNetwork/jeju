/**
 * RateLimiter Tests
 *
 * Tests for token bucket rate limiting
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { RateLimiter } from '../utils/rate-limiter'

describe('RateLimiter', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    limiter = new RateLimiter(10) // 10 messages per minute
  })

  describe('checkLimit', () => {
    it('should allow messages within limit', () => {
      const agentId = 'agent-1'

      // First 10 messages should be allowed
      for (let i = 0; i < 10; i++) {
        expect(limiter.checkLimit(agentId)).toBe(true)
      }
    })

    it('should block messages exceeding limit', () => {
      const agentId = 'agent-2'

      // Exhaust all tokens
      for (let i = 0; i < 10; i++) {
        limiter.checkLimit(agentId)
      }

      // 11th message should be blocked
      expect(limiter.checkLimit(agentId)).toBe(false)
    })

    it('should track limits per agent independently', () => {
      const agent1 = 'agent-1'
      const agent2 = 'agent-2'

      // Exhaust agent1's tokens
      for (let i = 0; i < 10; i++) {
        limiter.checkLimit(agent1)
      }

      // agent1 should be blocked
      expect(limiter.checkLimit(agent1)).toBe(false)

      // agent2 should still have tokens
      expect(limiter.checkLimit(agent2)).toBe(true)
    })

    it('should initialize new agents with full tokens', () => {
      const newAgent = 'new-agent'

      expect(limiter.getTokens(newAgent)).toBe(10)
    })
  })

  describe('getTokens', () => {
    it('should return current token count', () => {
      const agentId = 'agent-1'

      expect(limiter.getTokens(agentId)).toBe(10)

      limiter.checkLimit(agentId)
      expect(limiter.getTokens(agentId)).toBe(9)

      limiter.checkLimit(agentId)
      limiter.checkLimit(agentId)
      expect(limiter.getTokens(agentId)).toBe(7)
    })

    it('should return floor of token count', () => {
      const agentId = 'agent-1'

      // Use some tokens
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit(agentId)
      }

      const tokens = limiter.getTokens(agentId)
      expect(Number.isInteger(tokens)).toBe(true)
    })
  })

  describe('reset', () => {
    it('should reset rate limit for specific agent', () => {
      const agentId = 'agent-1'

      // Exhaust tokens
      for (let i = 0; i < 10; i++) {
        limiter.checkLimit(agentId)
      }

      expect(limiter.checkLimit(agentId)).toBe(false)

      // Reset
      limiter.reset(agentId)

      // Should have full tokens again
      expect(limiter.getTokens(agentId)).toBe(10)
      expect(limiter.checkLimit(agentId)).toBe(true)
    })

    it('should not affect other agents', () => {
      const agent1 = 'agent-1'
      const agent2 = 'agent-2'

      // Use some tokens for both
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit(agent1)
        limiter.checkLimit(agent2)
      }

      expect(limiter.getTokens(agent1)).toBe(5)
      expect(limiter.getTokens(agent2)).toBe(5)

      // Reset only agent1
      limiter.reset(agent1)

      expect(limiter.getTokens(agent1)).toBe(10)
      expect(limiter.getTokens(agent2)).toBe(5)
    })
  })

  describe('clear', () => {
    it('should clear all rate limit data', () => {
      const agent1 = 'agent-1'
      const agent2 = 'agent-2'

      // Use some tokens
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit(agent1)
        limiter.checkLimit(agent2)
      }

      // Clear all
      limiter.clear()

      // Both should have full tokens (new buckets created)
      expect(limiter.getTokens(agent1)).toBe(10)
      expect(limiter.getTokens(agent2)).toBe(10)
    })
  })

  describe('different rate limits', () => {
    it('should work with low rate limit', () => {
      const strictLimiter = new RateLimiter(1) // 1 message per minute
      const agentId = 'agent-1'

      expect(strictLimiter.checkLimit(agentId)).toBe(true)
      expect(strictLimiter.checkLimit(agentId)).toBe(false)
    })

    it('should work with high rate limit', () => {
      const looseLimiter = new RateLimiter(1000) // 1000 messages per minute
      const agentId = 'agent-1'

      // Should allow many messages
      for (let i = 0; i < 100; i++) {
        expect(looseLimiter.checkLimit(agentId)).toBe(true)
      }
    })
  })
})
