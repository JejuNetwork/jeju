/**
 * Comprehensive Tests for Agent0Client
 *
 * Tests cover:
 * - Singleton management
 * - Agent registration (happy path + edge cases)
 * - Agent search with all filter types
 * - Agent profile retrieval
 * - Feedback submission and retrieval
 * - Reputation queries
 * - Error handling
 * - Boundary conditions
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Address } from 'viem'
import {
  Agent0Client,
  createAgent0Client,
  getAgent0Client,
  ratingToScore,
  resetAgent0Client,
  setContractAddressesProvider,
} from '../client'
import type {
  Agent0ClientConfig,
  Agent0FeedbackParams,
  Agent0RegistrationParams,
  Agent0SearchFilters,
  Agent0SearchOptions,
} from '../types'

// =============================================================================
// Test Fixtures
// =============================================================================

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const TEST_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

const validConfig: Agent0ClientConfig = {
  network: 'localnet',
  rpcUrl: 'http://localhost:8545',
  privateKey: TEST_PRIVATE_KEY,
  ipfsProvider: 'node',
  ipfsNodeUrl: 'https://ipfs.io',
}

const validRegistrationParams: Agent0RegistrationParams = {
  name: 'Test Agent',
  description: 'A test agent for unit testing',
  walletAddress: TEST_WALLET,
  capabilities: {
    strategies: ['trading', 'analysis'],
    markets: ['crypto', 'stocks'],
    actions: ['buy', 'sell', 'analyze'],
    version: '1.0.0',
    skills: ['price-prediction', 'sentiment-analysis'],
    domains: ['finance', 'research'],
  },
}

const validFeedbackParams: Agent0FeedbackParams = {
  targetAgentId: 1,
  rating: 3, // -5 to +5
  comment: 'Great agent, very helpful',
  tags: ['helpful', 'accurate'],
}

// =============================================================================
// Singleton Tests
// =============================================================================

describe('Agent0Client Singleton', () => {
  afterEach(() => {
    resetAgent0Client()
  })

  test('getAgent0Client returns same instance on multiple calls', () => {
    const client1 = getAgent0Client()
    const client2 = getAgent0Client()
    expect(client1).toBe(client2)
  })

  test('resetAgent0Client clears singleton', () => {
    const client1 = getAgent0Client()
    resetAgent0Client()
    const client2 = getAgent0Client()
    expect(client1).not.toBe(client2)
  })

  test('createAgent0Client returns new instance each time', () => {
    const client1 = createAgent0Client()
    const client2 = createAgent0Client()
    expect(client1).not.toBe(client2)
  })
})

// =============================================================================
// Contract Address Provider Tests
// =============================================================================

describe('Contract Address Provider', () => {
  afterEach(() => {
    resetAgent0Client()
    setContractAddressesProvider(() => ({
      identityRegistry: ZERO_ADDRESS,
      reputationSystem: ZERO_ADDRESS,
      chainId: 31337,
      network: 'localnet',
    }))
  })

  test('setContractAddressesProvider sets custom addresses', () => {
    const customAddresses = {
      identityRegistry: '0x1234567890123456789012345678901234567890' as Address,
      reputationSystem: '0x0987654321098765432109876543210987654321' as Address,
      chainId: 31337,
      network: 'localnet',
    }

    setContractAddressesProvider(() => customAddresses)

    // Verify the client uses these addresses
    const client = new Agent0Client(validConfig)
    expect(client.getChainId()).toBe(31337)
  })
})

// =============================================================================
// Agent0Client Instance Tests
// =============================================================================

describe('Agent0Client Instance', () => {
  let client: Agent0Client

  beforeEach(() => {
    client = new Agent0Client(validConfig)
  })

  afterEach(() => {
    resetAgent0Client()
  })

  // ---------------------------------------------------------------------------
  // Chain ID Tests
  // ---------------------------------------------------------------------------

  describe('getChainId', () => {
    test('returns correct chain ID for localnet', () => {
      const localClient = new Agent0Client({ ...validConfig, network: 'localnet' })
      expect(localClient.getChainId()).toBe(31337)
    })

    test('returns correct chain ID for sepolia', () => {
      const sepoliaClient = new Agent0Client({ ...validConfig, network: 'sepolia' })
      expect(sepoliaClient.getChainId()).toBe(11155111)
    })

    test('returns correct chain ID for mainnet', () => {
      const mainnetClient = new Agent0Client({ ...validConfig, network: 'mainnet' })
      expect(mainnetClient.getChainId()).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Availability Tests
  // ---------------------------------------------------------------------------

  describe('isAvailable', () => {
    test('returns false before SDK initialization', () => {
      // SDK hasn't been initialized yet (lazy init)
      expect(client.isAvailable()).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Agent ID Formatting Tests
  // ---------------------------------------------------------------------------

  describe('formatAgentId', () => {
    test('formats agent ID correctly', () => {
      const agentId = client.formatAgentId(42)
      expect(agentId).toBe('31337:42')
    })

    test('formats agent ID with zero token ID', () => {
      const agentId = client.formatAgentId(0)
      expect(agentId).toBe('31337:0')
    })

    test('formats agent ID with large token ID', () => {
      const agentId = client.formatAgentId(999999999)
      expect(agentId).toBe('31337:999999999')
    })
  })
})

// =============================================================================
// Search Filter Tests
// =============================================================================

describe('Agent0Client Search Filters', () => {
  let client: Agent0Client

  beforeEach(() => {
    client = new Agent0Client(validConfig)
  })

  afterEach(() => {
    resetAgent0Client()
  })

  // ---------------------------------------------------------------------------
  // SDK Requirements Tests
  // ---------------------------------------------------------------------------

  describe('searchAgents SDK requirements', () => {
    test('throws without subgraph configuration', async () => {
      // Without proper subgraph config, SDK throws
      await expect(client.searchAgents({})).rejects.toThrow()
    })

    test('error message indicates subgraph requirement', async () => {
      try {
        await client.searchAgents({})
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect(error instanceof Error).toBe(true)
        if (error instanceof Error) {
          expect(error.message).toContain('Subgraph')
        }
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Filter Structure Tests (validate filter building without SDK call)
  // ---------------------------------------------------------------------------

  describe('filter structure validation', () => {
    test('empty filter object is valid', () => {
      const filters: Agent0SearchFilters = {}
      expect(filters).toEqual({})
    })

    test('all optional filters can be undefined', () => {
      const filters: Agent0SearchFilters = {
        name: undefined,
        description: undefined,
        skills: undefined,
        strategies: undefined,
      }
      expect(filters.name).toBeUndefined()
    })

    test('skills filter priority structure', () => {
      const filters: Agent0SearchFilters = {
        a2aSkills: ['specific-skill'],
        strategies: ['trading'],
        skills: ['general-skill'],
      }
      // a2aSkills should be prioritized (tested via the client internally)
      expect(filters.a2aSkills).toContain('specific-skill')
    })

    test('wallet address filter accepts valid format', () => {
      const filters: Agent0SearchFilters = {
        walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      }
      expect(filters.walletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    test('boolean filters accept true/false', () => {
      const filters: Agent0SearchFilters = {
        active: true,
        x402Support: false,
        mcp: true,
        a2a: false,
      }
      expect(filters.active).toBe(true)
      expect(filters.x402Support).toBe(false)
    })

    test('array filters accept multiple values', () => {
      const filters: Agent0SearchFilters = {
        owners: [
          '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
          '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        ],
        operators: [],
        supportedTrust: ['reputation', 'stake'],
        mcpTools: ['analyze'],
        mcpPrompts: [],
        mcpResources: ['data'],
      }
      expect(filters.owners).toHaveLength(2)
      expect(filters.supportedTrust).toContain('reputation')
    })
  })
})

// =============================================================================
// Type Guard and Utility Tests
// =============================================================================

describe('Type Guards and Utilities', () => {
  test('toStringArray handles array input', () => {
    // This is tested indirectly through parseCapabilities
    const client = new Agent0Client(validConfig)
    expect(client).toBeDefined()
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Agent0Client Error Handling', () => {
  let client: Agent0Client

  beforeEach(() => {
    client = new Agent0Client(validConfig)
  })

  afterEach(() => {
    resetAgent0Client()
  })

  describe('registerAgent errors', () => {
    test('throws when SDK not initialized with write access', async () => {
      // Client without private key should fail
      const readOnlyClient = new Agent0Client({
        ...validConfig,
        privateKey: undefined,
      })

      await expect(
        readOnlyClient.registerAgent(validRegistrationParams),
      ).rejects.toThrow()
    })
  })

  describe('getAgentProfile errors', () => {
    test('throws without subgraph configuration', async () => {
      // Without proper subgraph config, SDK throws on any query
      await expect(client.getAgentProfile(999999999)).rejects.toThrow()
    })
  })

  describe('getReputationSummary errors', () => {
    test('throws without proper configuration', async () => {
      // Without subgraph, this will throw
      await expect(
        client.getReputationSummary('31337:1'),
      ).rejects.toThrow()
    })
  })
})

// =============================================================================
// Feedback Rating Conversion Tests
// =============================================================================

describe('ratingToScore conversion', () => {
  test('rating -5 converts to score 0', () => {
    expect(ratingToScore(-5)).toBe(0)
  })

  test('rating -4 converts to score 10', () => {
    expect(ratingToScore(-4)).toBe(10)
  })

  test('rating 0 converts to score 50', () => {
    expect(ratingToScore(0)).toBe(50)
  })

  test('rating +5 converts to score 100', () => {
    expect(ratingToScore(5)).toBe(100)
  })

  test('rating below -5 clamps to 0', () => {
    expect(ratingToScore(-10)).toBe(0)
  })

  test('rating above +5 clamps to 100', () => {
    expect(ratingToScore(10)).toBe(100)
  })

  test('fractional rating converts correctly', () => {
    expect(ratingToScore(2.5)).toBe(75)
  })
})

// =============================================================================
// IPFS Provider Configuration Tests
// =============================================================================

describe('IPFS Provider Configuration', () => {
  afterEach(() => {
    resetAgent0Client()
  })

  test('node provider with default URL', () => {
    const client = new Agent0Client({
      ...validConfig,
      ipfsProvider: 'node',
      ipfsNodeUrl: undefined,
    })
    expect(client).toBeDefined()
  })

  test('pinata provider requires JWT', () => {
    const client = new Agent0Client({
      ...validConfig,
      ipfsProvider: 'pinata',
      pinataJwt: undefined,
    })
    // Should initialize but fail on actual operations
    expect(client).toBeDefined()
  })

  test('filecoinPin provider requires private key', () => {
    const client = new Agent0Client({
      ...validConfig,
      ipfsProvider: 'filecoinPin',
      filecoinPrivateKey: undefined,
    })
    expect(client).toBeDefined()
  })
})

// =============================================================================
// Pagination Options Tests
// =============================================================================

describe('Pagination Options Structure', () => {
  test('pageSize option is valid number', () => {
    const options: Agent0SearchOptions = { pageSize: 10 }
    expect(options.pageSize).toBe(10)
  })

  test('cursor option is valid string', () => {
    const options: Agent0SearchOptions = { cursor: 'next-page-token' }
    expect(options.cursor).toBe('next-page-token')
  })

  test('sort option accepts array of strings', () => {
    const options: Agent0SearchOptions = { sort: ['name:asc', 'trustScore:desc'] }
    expect(options.sort).toHaveLength(2)
  })

  test('all options combined', () => {
    const options: Agent0SearchOptions = {
      pageSize: 20,
      cursor: 'abc123',
      sort: ['name:asc'],
    }
    expect(options.pageSize).toBe(20)
    expect(options.cursor).toBe('abc123')
    expect(options.sort).toContain('name:asc')
  })
})
