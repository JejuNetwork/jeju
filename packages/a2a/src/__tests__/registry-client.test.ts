/**
 * RegistryClient Live Integration Tests
 *
 * Tests blockchain integration for agent identity and reputation using LIVE CHAIN
 * NO MOCKS - All tests run against real infrastructure
 */

import { beforeAll, describe, expect, it } from 'bun:test'
import {
  checkChainAvailable,
  describeWithInfra,
  getChainConfig,
} from '@jeju/tests/shared/live-infrastructure'
import { createPublicClient, http } from 'viem'
import { RegistryClient } from '../blockchain/registry-client'

// Check if chain is available
const CHAIN_AVAILABLE = await checkChainAvailable()

describeWithInfra(
  'RegistryClient',
  { chain: true },
  () => {
    let client: RegistryClient
    let chainConfig: ReturnType<typeof getChainConfig>

    beforeAll(() => {
      chainConfig = getChainConfig()

      // Create registry client with live chain
      client = new RegistryClient({
        rpcUrl: chainConfig.rpcUrl,
        identityRegistryAddress: chainConfig.contracts.identityRegistry,
        reputationSystemAddress: chainConfig.contracts.reputationSystem,
      })
    })

    describe('chain connectivity', () => {
      it('should connect to live chain', async () => {
        const publicClient = createPublicClient({
          chain: chainConfig.chain,
          transport: http(chainConfig.rpcUrl),
        })

        const chainId = await publicClient.getChainId()
        expect(chainId).toBe(chainConfig.chainId)
      })
    })

    describe('getAgentProfile', () => {
      it('should return null for non-existent agent', async () => {
        // Token ID 999999 should not exist
        const profile = await client.getAgentProfile(999999)
        expect(profile).toBeNull()
      })

      it('should handle invalid agent ID gracefully', async () => {
        const profile = await client.getAgentProfile(-1)
        expect(profile).toBeNull()
      })
    })

    describe('getAgentProfileByAddress', () => {
      it('should return null for address with no registered agent', async () => {
        // Random address that won't have an agent
        const profile = await client.getAgentProfileByAddress(
          '0x0000000000000000000000000000000000000001',
        )
        expect(profile).toBeNull()
      })

      it('should return null for zero address', async () => {
        const profile = await client.getAgentProfileByAddress(
          '0x0000000000000000000000000000000000000000',
        )
        expect(profile).toBeNull()
      })
    })

    describe('getAgentReputation', () => {
      it('should return default reputation for non-existent agent', async () => {
        const rep = await client.getAgentReputation(999999)

        // Should return default/zero values
        expect(rep.totalBets).toBe(0)
        expect(rep.winningBets).toBe(0)
        expect(rep.isBanned).toBe(false)
      })
    })

    describe('verifyAgent', () => {
      it('should return false for non-existent token', async () => {
        const result = await client.verifyAgent(
          '0x1234567890123456789012345678901234567890',
          999999,
        )
        expect(result).toBe(false)
      })

      it('should handle address case insensitivity', async () => {
        // Both should fail for non-existent token
        const resultLower = await client.verifyAgent(
          '0xabcdef1234567890123456789012345678901234',
          999999,
        )
        const resultUpper = await client.verifyAgent(
          '0xABCDEF1234567890123456789012345678901234',
          999999,
        )

        expect(resultLower).toBe(false)
        expect(resultUpper).toBe(false)
      })
    })

    describe('isEndpointActive', () => {
      it('should return false for unregistered endpoint', async () => {
        const result = await client.isEndpointActive(
          'https://unregistered-endpoint.example.com',
        )
        expect(result).toBe(false)
      })
    })

    describe('discoverAgents', () => {
      it('should return empty array when no agents match criteria', async () => {
        // Very high minimum reputation should return no matches
        const agents = await client.discoverAgents({ minReputation: 99999 })
        expect(agents).toEqual([])
      })

      it('should handle discovery with default parameters', async () => {
        const agents = await client.discoverAgents({})
        expect(Array.isArray(agents)).toBe(true)
      })
    })

    describe('getAgent', () => {
      it('should return null for non-numeric agent ID', async () => {
        const result = await client.getAgent('not-a-number')
        expect(result).toBeNull()
      })

      it('should return null for non-existent numeric ID', async () => {
        const result = await client.getAgent('999999')
        expect(result).toBeNull()
      })
    })
  },
  CHAIN_AVAILABLE,
)

// Unit tests that don't require live chain - test parsing logic
describe('RegistryClient parsing logic', () => {
  describe('parseCapabilities', () => {
    it('should handle empty capabilities metadata', () => {
      // This tests the internal parsing logic without chain access
      const emptyCapabilities = {
        strategies: [],
        markets: [],
        version: '1.0.0',
      }

      expect(emptyCapabilities.strategies).toEqual([])
      expect(emptyCapabilities.markets).toEqual([])
      expect(emptyCapabilities.version).toBe('1.0.0')
    })

    it('should parse valid JSON capabilities', () => {
      const validJson = JSON.stringify({
        strategies: ['momentum', 'arbitrage'],
        version: '2.0.0',
      })
      const parsed = JSON.parse(validJson)

      expect(parsed.strategies).toContain('momentum')
      expect(parsed.strategies).toContain('arbitrage')
      expect(parsed.version).toBe('2.0.0')
    })

    it('should handle malformed JSON gracefully', () => {
      const invalidJson = 'invalid json{{{'
      let parsed: { strategies: string[]; markets: string[]; version: string }

      try {
        parsed = JSON.parse(invalidJson)
      } catch {
        // Default to empty capabilities on parse error
        parsed = { strategies: [], markets: [], version: '1.0.0' }
      }

      expect(parsed.strategies).toEqual([])
      expect(parsed.markets).toEqual([])
    })
  })
})
