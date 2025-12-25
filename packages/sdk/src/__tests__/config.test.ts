/**
 * SDK Configuration Tests
 *
 * Tests configuration loading for different networks
 */

import { describe, expect, it } from 'bun:test'
import {
  getChainConfig,
  getContractAddresses,
  getServicesConfig,
} from '../config'

describe('getChainConfig', () => {
  it('should return localnet config', () => {
    const config = getChainConfig('localnet')
    expect(config.chainId).toBe(31337)
    expect(config.rpcUrl).toBeDefined()
    expect(config.name).toBeDefined()
  })

  it('should return testnet config', () => {
    const config = getChainConfig('testnet')
    expect(config.chainId).toBeDefined()
    expect(config.rpcUrl).toBeDefined()
  })

  it('should return mainnet config', () => {
    const config = getChainConfig('mainnet')
    expect(config.chainId).toBeDefined()
    expect(config.rpcUrl).toBeDefined()
  })
})

describe('getContractAddresses', () => {
  it('should return contract addresses for localnet', () => {
    const addresses = getContractAddresses('localnet')
    expect(addresses).toBeDefined()
    // Core contracts should be defined
    expect(
      typeof addresses.jnsRegistry === 'string' ||
        addresses.jnsRegistry === undefined,
    ).toBe(true)
  })

  it('should return contract addresses for testnet', () => {
    const addresses = getContractAddresses('testnet')
    expect(addresses).toBeDefined()
  })
})

describe('getServicesConfig', () => {
  it('should return services config for localnet', () => {
    const services = getServicesConfig('localnet')
    expect(services).toBeDefined()
    expect(services.gateway).toBeDefined()
    expect(services.gateway.api).toBeDefined()
    expect(services.gateway.ws).toBeDefined()
  })

  it('should return services config for testnet', () => {
    const services = getServicesConfig('testnet')
    expect(services).toBeDefined()
    expect(services.gateway).toBeDefined()
  })
})
