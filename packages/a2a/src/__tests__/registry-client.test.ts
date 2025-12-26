/**
 * RegistryClient Tests
 *
 * Tests blockchain integration for agent identity and reputation
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import * as viemModule from 'viem'
import { RegistryClient } from '../blockchain/registry-client'

// Mock viem createPublicClient
const mockReadContract = mock(() => Promise.resolve([]))

mock.module('viem', () => ({
  ...viemModule,
  createPublicClient: () => ({
    readContract: mockReadContract,
  }),
  http: () => ({}),
}))

describe('RegistryClient', () => {
  let client: RegistryClient

  beforeEach(() => {
    mockReadContract.mockReset()
    client = new RegistryClient({
      rpcUrl: 'http://127.0.0.1:8545',
      identityRegistryAddress: '0x1234567890123456789012345678901234567890',
      reputationSystemAddress: '0x0987654321098765432109876543210987654321',
    })
  })

  describe('getAgentProfile', () => {
    it('should fetch and parse agent profile from blockchain', async () => {
      // Mock identity contract response
      mockReadContract
        .mockResolvedValueOnce([
          'TestAgent', // name
          'https://agent.example.com', // endpoint
          '0x1234', // capabilitiesHash
          BigInt(1700000000), // registeredAt
          true, // isActive
          JSON.stringify({ strategies: ['momentum'], version: '1.0.0' }), // metadata
        ])
        // Mock reputation contract response
        .mockResolvedValueOnce([
          BigInt(100), // totalBets
          BigInt(75), // winningBets
          BigInt(1000000), // totalVolume
          BigInt(50000), // profitLoss
          BigInt(750), // accuracyScore
          BigInt(800), // trustScore
          false, // isBanned
        ])
        // Mock ownerOf response
        .mockResolvedValueOnce('0xAgentOwner')

      const profile = await client.getAgentProfile(1)

      expect(profile).not.toBeNull()
      expect(profile?.name).toBe('TestAgent')
      expect(profile?.endpoint).toBe('https://agent.example.com')
      expect(profile?.isActive).toBe(true)
      expect(profile?.capabilities.strategies).toContain('momentum')
      expect(profile?.reputation.totalBets).toBe(100)
      expect(profile?.reputation.trustScore).toBe(800)
    })
  })

  describe('getAgentProfileByAddress', () => {
    it('should return null if no token found for address', async () => {
      mockReadContract.mockResolvedValueOnce(0n)

      const profile = await client.getAgentProfileByAddress(
        '0x0000000000000000000000000000000000000000',
      )

      expect(profile).toBeNull()
    })
  })

  describe('getAgentReputation', () => {
    it('should parse reputation data correctly', async () => {
      mockReadContract.mockResolvedValueOnce([
        BigInt(50), // totalBets
        BigInt(30), // winningBets
        BigInt(500000), // totalVolume
        BigInt(-10000), // profitLoss (negative)
        BigInt(600), // accuracyScore
        BigInt(700), // trustScore
        false, // isBanned
      ])

      const rep = await client.getAgentReputation(1)

      expect(rep.totalBets).toBe(50)
      expect(rep.winningBets).toBe(30)
      expect(rep.totalVolume).toBe('500000')
      expect(rep.profitLoss).toBe(-10000)
      expect(rep.accuracyScore).toBe(600)
      expect(rep.trustScore).toBe(700)
      expect(rep.isBanned).toBe(false)
    })
  })

  describe('verifyAgent', () => {
    it('should return true when address owns token', async () => {
      const address = '0x1234567890123456789012345678901234567890'
      mockReadContract.mockResolvedValueOnce(address)

      const result = await client.verifyAgent(address, 1)

      expect(result).toBe(true)
    })

    it('should return false when address does not own token', async () => {
      mockReadContract.mockResolvedValueOnce(
        '0xDifferentAddress00000000000000000000000000',
      )

      const result = await client.verifyAgent(
        '0x1234567890123456789012345678901234567890',
        1,
      )

      expect(result).toBe(false)
    })

    it('should handle case-insensitive address comparison', async () => {
      mockReadContract.mockResolvedValueOnce(
        '0xABCDEF1234567890123456789012345678901234',
      )

      const result = await client.verifyAgent(
        '0xabcdef1234567890123456789012345678901234',
        1,
      )

      expect(result).toBe(true)
    })
  })

  describe('isEndpointActive', () => {
    it('should return true for active endpoint', async () => {
      mockReadContract.mockResolvedValueOnce(true)

      const result = await client.isEndpointActive('https://active.example.com')

      expect(result).toBe(true)
    })

    it('should return false for inactive endpoint', async () => {
      mockReadContract.mockResolvedValueOnce(false)

      const result = await client.isEndpointActive(
        'https://inactive.example.com',
      )

      expect(result).toBe(false)
    })
  })


  describe('discoverAgents', () => {
    it('should filter agents by minReputation', async () => {
      // Mock getAgentsByMinScore
      mockReadContract.mockResolvedValueOnce([BigInt(1), BigInt(2)])

      // Mock getAgentProfile for each token (2 agents)
      // Agent 1
      mockReadContract
        .mockResolvedValueOnce([
          'Agent1',
          'https://agent1.example.com',
          '0x1234',
          BigInt(1700000000),
          true,
          JSON.stringify({ strategies: ['momentum'], version: '1.0.0' }),
        ])
        .mockResolvedValueOnce([
          BigInt(100),
          BigInt(75),
          BigInt(1000000),
          BigInt(50000),
          BigInt(750),
          BigInt(800),
          false,
        ])
        .mockResolvedValueOnce('0xOwner1')

      // Agent 2
      mockReadContract
        .mockResolvedValueOnce([
          'Agent2',
          'https://agent2.example.com',
          '0x5678',
          BigInt(1700000000),
          true,
          JSON.stringify({ strategies: ['arbitrage'], version: '1.0.0' }),
        ])
        .mockResolvedValueOnce([
          BigInt(200),
          BigInt(150),
          BigInt(2000000),
          BigInt(100000),
          BigInt(750),
          BigInt(900),
          false,
        ])
        .mockResolvedValueOnce('0xOwner2')

      const agents = await client.discoverAgents({ minReputation: 500 })

      expect(agents.length).toBe(2)
      expect(agents[0].name).toBe('Agent1')
      expect(agents[1].name).toBe('Agent2')
    })
  })

  describe('getAgent', () => {
    it('should return null for non-numeric agent ID', async () => {
      const result = await client.getAgent('not-a-number')

      expect(result).toBeNull()
    })
  })

  describe('parseCapabilities', () => {
    it('should return empty capabilities for invalid JSON metadata', async () => {
      mockReadContract
        .mockResolvedValueOnce([
          'TestAgent',
          'https://agent.example.com',
          '0x1234',
          BigInt(1700000000),
          true,
          'invalid json{{{',
        ])
        .mockResolvedValueOnce([
          BigInt(100),
          BigInt(75),
          BigInt(1000000),
          BigInt(50000),
          BigInt(750),
          BigInt(800),
          false,
        ])
        .mockResolvedValueOnce('0xAgentOwner')

      const profile = await client.getAgentProfile(1)

      expect(profile?.capabilities.strategies).toEqual([])
      expect(profile?.capabilities.markets).toEqual([])
      expect(profile?.capabilities.version).toBe('1.0.0')
    })
  })
})
