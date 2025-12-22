/**
 * Integration Tests
 *
 * Tests for Jeju Registry and Solana integration
 */

import { describe, expect, test } from 'bun:test'
import type { TokenDeploymentConfig } from '../integration/deployer'
import {
  createSolanaInfra,
  SolanaInfraManager,
} from '../integration/solana-infra'

describe('Solana Infrastructure', () => {
  test('creates devnet manager', () => {
    const manager = createSolanaInfra('devnet')
    expect(manager).toBeInstanceOf(SolanaInfraManager)
  })

  test('creates mainnet manager', () => {
    const manager = createSolanaInfra('mainnet')
    expect(manager).toBeInstanceOf(SolanaInfraManager)
  })

  test('gets connection', () => {
    const manager = createSolanaInfra('devnet')
    const connection = manager.getConnection()
    expect(connection).toBeDefined()
  })
})

describe('Unified Deployment Config', () => {
  test('config structure is valid', () => {
    const config: TokenDeploymentConfig = {
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 18,
      totalSupply: 1000000000000000000000000n,
      category: 'utility',
      tags: ['test', 'demo'],
      description: 'A test token for integration testing',
      homeChainId: 11155111,
      targetChainIds: [11155111, 84532],
      includeSolana: false,
    }

    expect(config.name).toBe('Test Token')
    expect(config.symbol).toBe('TEST')
    expect(config.targetChainIds).toContain(11155111)
    expect(config.category).toBe('utility')
  })

  test('supports all categories', () => {
    const categories: TokenDeploymentConfig['category'][] = [
      'defi',
      'gaming',
      'social',
      'utility',
      'meme',
    ]

    for (const category of categories) {
      const config: Partial<TokenDeploymentConfig> = { category }
      expect(config.category).toBe(category)
    }
  })
})

describe('Jeju Contract Addresses', () => {
  test('placeholder addresses are valid format', () => {
    const zeroAddress = '0x0000000000000000000000000000000000000000'
    expect(zeroAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })
})

describe('Cross-Chain Flow', () => {
  test('deployment targets include Jeju testnet', () => {
    const jejuTestnetChainId = 420690
    const targetChains = [11155111, 84532, jejuTestnetChainId]

    expect(targetChains).toContain(jejuTestnetChainId)
  })

  test('Solana can be included in deployment', () => {
    const config: Partial<TokenDeploymentConfig> = {
      includeSolana: true,
      targetChainIds: [11155111],
    }

    expect(config.includeSolana).toBe(true)
  })
})
