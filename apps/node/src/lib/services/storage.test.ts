/**
 * Storage Service Tests
 */

import { describe, expect, it } from 'bun:test'
import {
  CONTENT_REGISTRY_ABI,
  PROXY_REGISTRY_ABI,
  STORAGE_MARKET_ABI,
} from '../abis'

describe('Storage ABIs', () => {
  describe('STORAGE_MARKET_ABI', () => {
    it('has registerProvider function', () => {
      const registerProvider = STORAGE_MARKET_ABI.find(
        (item) => item.name === 'registerProvider',
      )
      expect(registerProvider).toBeDefined()
      expect(registerProvider?.type).toBe('function')
      expect(registerProvider?.stateMutability).toBe('payable')
    })

    it('has getProvider function', () => {
      const getProvider = STORAGE_MARKET_ABI.find(
        (item) => item.name === 'getProvider',
      )
      expect(getProvider).toBeDefined()
      expect(getProvider?.type).toBe('function')
      expect(getProvider?.stateMutability).toBe('view')
    })
  })

  describe('CONTENT_REGISTRY_ABI', () => {
    it('has registerContent function', () => {
      const registerContent = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'registerContent',
      )
      expect(registerContent).toBeDefined()
      expect(registerContent?.type).toBe('function')
      expect(registerContent?.stateMutability).toBe('payable')
      expect(registerContent?.inputs).toHaveLength(4)
    })

    it('has seeding functions', () => {
      const startSeeding = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'startSeeding',
      )
      const stopSeeding = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'stopSeeding',
      )
      const reportSeeding = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'reportSeeding',
      )

      expect(startSeeding).toBeDefined()
      expect(stopSeeding).toBeDefined()
      expect(reportSeeding).toBeDefined()
    })

    it('has moderation functions', () => {
      const flagContent = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'flagContent',
      )
      const canServe = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'canServe',
      )
      const isBlocked = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'isBlocked',
      )

      expect(flagContent).toBeDefined()
      expect(canServe).toBeDefined()
      expect(isBlocked).toBeDefined()
    })

    it('has reward functions', () => {
      const claimRewards = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'claimRewards',
      )
      const getSeederStats = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'getSeederStats',
      )
      const getRewardRate = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'getRewardRate',
      )

      expect(claimRewards).toBeDefined()
      expect(getSeederStats).toBeDefined()
      expect(getRewardRate).toBeDefined()
    })

    it('has blocklist functions', () => {
      const getBlocklistLength = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'getBlocklistLength',
      )
      const getBlocklistBatch = CONTENT_REGISTRY_ABI.find(
        (item) => item.name === 'getBlocklistBatch',
      )

      expect(getBlocklistLength).toBeDefined()
      expect(getBlocklistBatch).toBeDefined()
    })
  })
})

describe('Contract Addresses', () => {
  it('exports ContractAddresses interface with contentRegistry', async () => {
    const contracts = await import('../contracts')

    // Localnet should have all addresses
    const addresses = contracts.getContractAddresses(1337)

    expect(addresses.storageMarket).toBeDefined()
    expect(addresses.contentRegistry).toBeDefined()
    expect(addresses.storageMarket).toMatch(/^0x/)
    expect(addresses.contentRegistry).toMatch(/^0x/)
  })
})

// Note: Full StorageService tests require native modules (webtorrent)
// which don't work in Bun's test runner. The service works correctly
// when running in Node.js or the Tauri app.
describe('Storage Service Integration', () => {
  it('ABI is compatible with StorageService', () => {
    // Verify the ABI has all the functions the service expects
    const getProvider = CONTENT_REGISTRY_ABI.find(
      (f) => f.name === 'getContent',
    )
    expect(getProvider).toBeDefined()

    const seederStats = CONTENT_REGISTRY_ABI.find(
      (f) => f.name === 'getSeederStats',
    )
    expect(seederStats).toBeDefined()
    expect(seederStats?.outputs?.[0]?.type).toBe('tuple')
  })
})

describe('PROXY_REGISTRY_ABI', () => {
  it('has register function', () => {
    const register = PROXY_REGISTRY_ABI.find((f) => f.name === 'register')
    expect(register).toBeDefined()
    expect(register?.type).toBe('function')
    expect(register?.stateMutability).toBe('payable')
    expect(register?.inputs).toHaveLength(2)
  })

  it('has getNode function with correct output', () => {
    const getNode = PROXY_REGISTRY_ABI.find((f) => f.name === 'getNode')
    expect(getNode).toBeDefined()
    expect(getNode?.type).toBe('function')
    expect(getNode?.stateMutability).toBe('view')
    expect(getNode?.outputs?.[0]?.type).toBe('tuple')

    // Check tuple has expected components
    const components = getNode?.outputs?.[0]?.components
    expect(components?.find((c) => c.name === 'owner')).toBeDefined()
    expect(components?.find((c) => c.name === 'stake')).toBeDefined()
    expect(components?.find((c) => c.name === 'active')).toBeDefined()
  })

  it('has staking functions', () => {
    const addStake = PROXY_REGISTRY_ABI.find((f) => f.name === 'addStake')
    const withdrawStake = PROXY_REGISTRY_ABI.find(
      (f) => f.name === 'withdrawStake',
    )

    expect(addStake).toBeDefined()
    expect(withdrawStake).toBeDefined()
  })

  it('has session recording function', () => {
    const recordSession = PROXY_REGISTRY_ABI.find(
      (f) => f.name === 'recordSession',
    )
    expect(recordSession).toBeDefined()
    expect(recordSession?.inputs).toHaveLength(3)
  })
})
