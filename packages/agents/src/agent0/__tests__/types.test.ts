/**
 * Type Validation Tests
 *
 * Tests ensure type definitions are correct and can be used properly.
 * Validates interface structures and type constraints.
 */

import { describe, expect, test } from 'bun:test'
import type {
  Agent0AgentProfile,
  Agent0AgentUpdateParams,
  Agent0ClientConfig,
  Agent0ContractAddresses,
  Agent0Endpoint,
  Agent0Feedback,
  Agent0FeedbackParams,
  Agent0FeedbackSearchParams,
  Agent0Network,
  Agent0RegistrationParams,
  Agent0RegistrationResult,
  Agent0ReputationSummary,
  Agent0SearchFilters,
  Agent0SearchOptions,
  Agent0SearchResponse,
  Agent0SearchResult,
  Agent0SearchResultMeta,
  Agent0TransferResult,
  AggregatedReputation,
  AgentProfile,
  AgentReputation,
  DiscoveryFilters,
  IAgent0Client,
  IAgent0FeedbackService,
  IAgentDiscoveryService,
  IReputationBridge,
} from '../types'

// =============================================================================
// Type Structure Tests
// =============================================================================

describe('Type Structures', () => {
  // ---------------------------------------------------------------------------
  // Agent0ClientConfig Tests
  // ---------------------------------------------------------------------------

  describe('Agent0ClientConfig', () => {
    test('accepts valid localnet config', () => {
      const config: Agent0ClientConfig = {
        network: 'localnet',
        rpcUrl: 'http://localhost:8545',
      }
      expect(config.network).toBe('localnet')
      expect(config.rpcUrl).toBe('http://localhost:8545')
    })

    test('accepts config with all optional fields', () => {
      const config: Agent0ClientConfig = {
        network: 'sepolia',
        rpcUrl: 'https://sepolia.infura.io/v3/key',
        privateKey: '0x1234',
        ipfsProvider: 'pinata',
        ipfsNodeUrl: 'https://ipfs.io',
        pinataJwt: 'jwt-token',
        filecoinPrivateKey: '0x5678',
        subgraphUrl: 'https://api.thegraph.com',
      }
      expect(config.ipfsProvider).toBe('pinata')
    })

    test('accepts all network types', () => {
      const networks: Agent0Network[] = ['sepolia', 'mainnet', 'localnet']
      for (const network of networks) {
        const config: Agent0ClientConfig = {
          network,
          rpcUrl: 'http://test',
        }
        expect(config.network).toBe(network)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Agent0RegistrationParams Tests
  // ---------------------------------------------------------------------------

  describe('Agent0RegistrationParams', () => {
    test('accepts minimal params', () => {
      const params: Agent0RegistrationParams = {
        name: 'Test Agent',
        description: 'A test agent',
        walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        capabilities: {
          strategies: [],
          markets: [],
          actions: [],
          version: '1.0.0',
          skills: [],
          domains: [],
        },
      }
      expect(params.name).toBe('Test Agent')
    })

    test('accepts params with optional fields', () => {
      const params: Agent0RegistrationParams = {
        name: 'Full Agent',
        description: 'Agent with all fields',
        imageUrl: 'https://example.com/image.png',
        walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        mcpEndpoint: 'https://agent.com/mcp',
        a2aEndpoint: 'https://agent.com/a2a',
        capabilities: {
          strategies: ['trading', 'arbitrage'],
          markets: ['crypto', 'forex'],
          actions: ['buy', 'sell', 'analyze'],
          version: '2.0.0',
          skills: ['analysis', 'prediction'],
          domains: ['finance', 'tech'],
          x402Support: true,
        },
      }
      expect(params.mcpEndpoint).toBe('https://agent.com/mcp')
    })
  })

  // ---------------------------------------------------------------------------
  // Agent0SearchFilters Tests
  // ---------------------------------------------------------------------------

  describe('Agent0SearchFilters', () => {
    test('accepts empty filters', () => {
      const filters: Agent0SearchFilters = {}
      expect(filters).toEqual({})
    })

    test('accepts all filter types', () => {
      const filters: Agent0SearchFilters = {
        name: 'Agent',
        description: 'trading',
        skills: ['trading'],
        strategies: ['arbitrage'],
        markets: ['crypto'],
        minReputation: 50,
        type: 'agent',
        active: true,
        x402Support: true,
        hasX402: true,
        chains: [1, 11155111],
        owners: ['0x123'],
        operators: ['0x456'],
        mcp: true,
        a2a: false,
        ens: 'agent.eth',
        did: 'did:web:agent',
        walletAddress: '0x789',
        supportedTrust: ['reputation'],
        mcpTools: ['tool1'],
        mcpPrompts: ['prompt1'],
        mcpResources: ['resource1'],
        a2aSkills: ['skill1'],
      }
      expect(filters.active).toBe(true)
    })

    test('accepts chains as "all"', () => {
      const filters: Agent0SearchFilters = {
        chains: 'all',
      }
      expect(filters.chains).toBe('all')
    })
  })

  // ---------------------------------------------------------------------------
  // Agent0SearchOptions Tests
  // ---------------------------------------------------------------------------

  describe('Agent0SearchOptions', () => {
    test('accepts empty options', () => {
      const options: Agent0SearchOptions = {}
      expect(options).toEqual({})
    })

    test('accepts all options', () => {
      const options: Agent0SearchOptions = {
        pageSize: 20,
        cursor: 'next-page',
        sort: ['name:asc', 'trustScore:desc'],
      }
      expect(options.pageSize).toBe(20)
    })
  })

  // ---------------------------------------------------------------------------
  // Agent0SearchResult Tests
  // ---------------------------------------------------------------------------

  describe('Agent0SearchResult', () => {
    test('contains required fields', () => {
      const result: Agent0SearchResult = {
        tokenId: 1,
        name: 'Agent',
        walletAddress: '0x123',
        metadataCID: 'QmTest',
        capabilities: {
          strategies: [],
          markets: [],
          actions: [],
          version: '1.0.0',
          skills: [],
          domains: [],
        },
        reputation: {
          trustScore: 85,
          accuracyScore: 90,
        },
      }
      expect(result.tokenId).toBe(1)
    })

    test('contains optional fields', () => {
      const result: Agent0SearchResult = {
        tokenId: 1,
        name: 'Full Agent',
        walletAddress: '0x123',
        metadataCID: 'QmTest',
        capabilities: {
          strategies: ['trading'],
          markets: ['crypto'],
          actions: ['buy'],
          version: '1.0.0',
          skills: [],
          domains: [],
        },
        reputation: {
          trustScore: 85,
          accuracyScore: 90,
        },
        chainId: 1,
        description: 'A trading agent',
        image: 'https://example.com/image.png',
        owners: ['0x456'],
        operators: ['0x789'],
        mcp: true,
        a2a: true,
        ens: 'agent.eth',
        did: 'did:web:agent',
        supportedTrusts: ['reputation'],
        a2aSkills: ['trading'],
        mcpTools: ['analyze'],
        mcpPrompts: ['trade-prompt'],
        mcpResources: ['market-data'],
        active: true,
        x402support: true,
      }
      expect(result.mcp).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Agent0Feedback Tests
  // ---------------------------------------------------------------------------

  describe('Agent0FeedbackParams', () => {
    test('accepts minimal params', () => {
      const params: Agent0FeedbackParams = {
        targetAgentId: 1,
        rating: 3,
        comment: 'Good agent',
      }
      expect(params.rating).toBe(3)
    })

    test('accepts all params', () => {
      const params: Agent0FeedbackParams = {
        targetAgentId: 1,
        rating: 5,
        comment: 'Excellent agent',
        transactionId: 'tx123',
        tags: ['helpful', 'fast'],
        capability: 'trading',
        skill: 'analysis',
        task: 'price-prediction',
        context: { market: 'crypto' },
        proofOfPayment: { txHash: '0x123' },
      }
      expect(params.tags).toContain('helpful')
    })

    test('rating can be negative', () => {
      const params: Agent0FeedbackParams = {
        targetAgentId: 1,
        rating: -5,
        comment: 'Poor performance',
      }
      expect(params.rating).toBe(-5)
    })
  })

  // ---------------------------------------------------------------------------
  // Agent0FeedbackSearchParams Tests
  // ---------------------------------------------------------------------------

  describe('Agent0FeedbackSearchParams', () => {
    test('accepts all search params', () => {
      const params: Agent0FeedbackSearchParams = {
        agents: ['31337:1', '31337:2'],
        tags: ['trading', 'helpful'],
        reviewers: ['0x123'],
        capabilities: ['trading'],
        skills: ['analysis'],
        tasks: ['prediction'],
        names: ['Agent1'],
        minScore: 50,
        maxScore: 100,
        includeRevoked: false,
      }
      expect(params.minScore).toBe(50)
    })
  })

  // ---------------------------------------------------------------------------
  // AggregatedReputation Tests
  // ---------------------------------------------------------------------------

  describe('AggregatedReputation', () => {
    test('has all required fields', () => {
      const rep: AggregatedReputation = {
        totalBets: 100,
        winningBets: 75,
        accuracyScore: 0.75,
        trustScore: 0.85,
        totalVolume: '1000000000000000000',
        profitLoss: 500,
        isBanned: false,
        sources: {
          local: 80,
          agent0: 90,
        },
      }
      expect(rep.totalBets).toBe(100)
      expect(rep.sources.local).toBe(80)
    })
  })

  // ---------------------------------------------------------------------------
  // Agent0Endpoint Tests
  // ---------------------------------------------------------------------------

  describe('Agent0Endpoint', () => {
    test('accepts all endpoint types', () => {
      const endpoints: Agent0Endpoint[] = [
        { type: 'MCP', value: 'https://agent.com/mcp' },
        { type: 'A2A', value: 'https://agent.com/a2a' },
        { type: 'ENS', value: 'agent.eth' },
        { type: 'DID', value: 'did:web:agent' },
        { type: 'wallet', value: '0x123' },
        { type: 'OASF', value: 'https://agent.com/oasf' },
      ]
      expect(endpoints).toHaveLength(6)
    })

    test('accepts meta field', () => {
      const endpoint: Agent0Endpoint = {
        type: 'MCP',
        value: 'https://agent.com/mcp',
        meta: {
          version: '1.0.0',
          tools: ['analyze', 'predict'],
        },
      }
      expect(endpoint.meta).toBeDefined()
    })
  })

  // ---------------------------------------------------------------------------
  // Interface Implementation Tests
  // ---------------------------------------------------------------------------

  describe('Interface Implementations', () => {
    test('IAgent0Client interface has all methods', () => {
      // This is a compile-time check - if types are wrong, it won't compile
      const methodNames: (keyof IAgent0Client)[] = [
        'registerAgent',
        'searchAgents',
        'searchAgentsByReputation',
        'getAgentProfile',
        'loadAgent',
        'updateAgent',
        'transferAgent',
        'isAgentOwner',
        'getAgentOwner',
        'submitFeedback',
        'getFeedback',
        'searchFeedback',
        'revokeFeedback',
        'appendFeedbackResponse',
        'getReputationSummary',
        'isAvailable',
        'getChainId',
        'formatAgentId',
      ]
      expect(methodNames.length).toBe(18)
    })

    test('IAgentDiscoveryService interface has all methods', () => {
      const methodNames: (keyof IAgentDiscoveryService)[] = [
        'discoverAgents',
        'getAgent',
      ]
      expect(methodNames.length).toBe(2)
    })

    test('IReputationBridge interface has all methods', () => {
      const methodNames: (keyof IReputationBridge)[] = [
        'getAggregatedReputation',
        'getAgent0ReputationSummary',
      ]
      expect(methodNames.length).toBe(2)
    })

    test('IAgent0FeedbackService interface has all methods', () => {
      const methodNames: (keyof IAgent0FeedbackService)[] = [
        'submitFeedback',
        'getFeedback',
        'searchFeedback',
        'revokeFeedback',
        'appendResponse',
        'getReputationSummary',
      ]
      expect(methodNames.length).toBe(6)
    })
  })

  // ---------------------------------------------------------------------------
  // DiscoveryFilters Tests
  // ---------------------------------------------------------------------------

  describe('DiscoveryFilters', () => {
    test('accepts all filter types', () => {
      const filters: DiscoveryFilters = {
        strategies: ['trading'],
        markets: ['crypto'],
        minReputation: 50,
        includeExternal: true,
        skills: ['analysis'],
        active: true,
        x402Support: true,
        chains: [1, 11155111],
        mcp: true,
        a2a: true,
      }
      expect(filters.includeExternal).toBe(true)
    })

    test('chains can be "all"', () => {
      const filters: DiscoveryFilters = {
        chains: 'all',
      }
      expect(filters.chains).toBe('all')
    })
  })

  // ---------------------------------------------------------------------------
  // Contract Addresses Tests
  // ---------------------------------------------------------------------------

  describe('Agent0ContractAddresses', () => {
    test('has all required fields', () => {
      const addresses: Agent0ContractAddresses = {
        identityRegistry: '0x1234567890123456789012345678901234567890',
        reputationSystem: '0x0987654321098765432109876543210987654321',
        chainId: 1,
        network: 'mainnet',
      }
      expect(addresses.chainId).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Result Types Tests
  // ---------------------------------------------------------------------------

  describe('Result Types', () => {
    test('Agent0RegistrationResult has all fields', () => {
      const result: Agent0RegistrationResult = {
        tokenId: 1,
        txHash: '0xabc123',
        metadataCID: 'QmTest',
      }
      expect(result.tokenId).toBe(1)
    })

    test('Agent0TransferResult has all fields', () => {
      const result: Agent0TransferResult = {
        txHash: '0xabc123',
        from: '0x123',
        to: '0x456',
        agentId: '31337:1',
      }
      expect(result.from).toBe('0x123')
    })

    test('Agent0ReputationSummary has all fields', () => {
      const summary: Agent0ReputationSummary = {
        count: 100,
        averageScore: 85,
      }
      expect(summary.count).toBe(100)
    })

    test('Agent0SearchResultMeta has all fields', () => {
      const meta: Agent0SearchResultMeta = {
        chains: [1, 11155111],
        successfulChains: [1],
        failedChains: [11155111],
        totalResults: 50,
        timing: {
          totalMs: 1500,
          averagePerChainMs: 750,
        },
      }
      expect(meta.totalResults).toBe(50)
    })
  })

  // ---------------------------------------------------------------------------
  // AgentProfile and AgentReputation Tests
  // ---------------------------------------------------------------------------

  describe('AgentProfile', () => {
    test('has all required fields', () => {
      const profile: AgentProfile = {
        agentId: '31337:1',
        tokenId: 1,
        address: '0x123',
        name: 'Agent',
        endpoint: 'https://agent.com/a2a',
        capabilities: {
          strategies: [],
          markets: [],
          actions: [],
          version: '1.0.0',
          skills: [],
          domains: [],
        },
        reputation: {
          totalBets: 0,
          winningBets: 0,
          accuracyScore: 0,
          trustScore: 0,
          totalVolume: '0',
          profitLoss: 0,
          isBanned: false,
        },
        isActive: true,
      }
      expect(profile.agentId).toBe('31337:1')
    })
  })

  describe('AgentReputation', () => {
    test('has all required fields', () => {
      const rep: AgentReputation = {
        totalBets: 100,
        winningBets: 75,
        accuracyScore: 0.75,
        trustScore: 0.85,
        totalVolume: '1000000000000000000',
        profitLoss: 500,
        isBanned: false,
      }
      expect(rep.accuracyScore).toBe(0.75)
    })
  })
})
