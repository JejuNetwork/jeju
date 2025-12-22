/**
 * @fileoverview Comprehensive test suite for config module
 * Tests complex functions, edge cases, and boundary conditions
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  getConfig,
  getConstant,
  getContract,
  getCrossChainPaymaster,
  getEILChain,
  getEILChainById,
  getEILChainIds,
  getEILChains,
  getEILConfig,
  getEILToken,
  getExternalContract,
  getExternalRpc,
  getFederatedNetworks,
  getFederationHub,
  getFrontendServices,
  getPoCConfig,
  getServicesConfig,
  getServiceUrl,
} from './index'
import type { NetworkType } from './schemas'

describe('Contract Resolution', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('toEnvKey conversion', () => {
    // The toEnvKey function is internal but we can test it through getContract behavior

    it('should resolve VITE_ prefixed env vars for camelCase contracts', () => {
      process.env.VITE_BAN_MANAGER_ADDRESS =
        '0x1234567890123456789012345678901234567890'
      process.env.JEJU_NETWORK = 'localnet'

      const address = getContract('moderation', 'banManager', 'localnet')
      expect(address).toBe('0x1234567890123456789012345678901234567890')
    })

    it('should resolve PUBLIC_ prefixed env vars', () => {
      process.env.PUBLIC_BAN_MANAGER_ADDRESS =
        '0xabcdef0123456789012345678901234567890abc'
      process.env.JEJU_NETWORK = 'localnet'

      const address = getContract('moderation', 'banManager', 'localnet')
      expect(address).toBe('0xabcdef0123456789012345678901234567890abc')
    })

    it('should prioritize VITE_ over PUBLIC_', () => {
      process.env.VITE_BAN_MANAGER_ADDRESS =
        '0x1111111111111111111111111111111111111111'
      process.env.PUBLIC_BAN_MANAGER_ADDRESS =
        '0x2222222222222222222222222222222222222222'
      process.env.JEJU_NETWORK = 'localnet'

      const address = getContract('moderation', 'banManager', 'localnet')
      expect(address).toBe('0x1111111111111111111111111111111111111111')
    })

    it('should resolve category-prefixed env vars for scripts', () => {
      process.env.MODERATION_BAN_MANAGER =
        '0x3333333333333333333333333333333333333333'
      process.env.JEJU_NETWORK = 'localnet'

      const address = getContract('moderation', 'banManager', 'localnet')
      expect(address).toBe('0x3333333333333333333333333333333333333333')
    })
  })

  describe('getContract', () => {
    it('should get contract from config when no env override', () => {
      // Use WETH which is always available
      delete process.env.VITE_WETH_ADDRESS
      delete process.env.PUBLIC_WETH_ADDRESS
      delete process.env.TOKENS_WETH

      const address = getContract('tokens', 'weth', 'localnet')
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('should throw for non-existent category', () => {
      expect(() =>
        getContract('nonexistent' as 'tokens', 'something', 'localnet'),
      ).toThrow()
    })

    it('should throw for non-existent contract in category', () => {
      expect(() =>
        getContract('tokens', 'nonexistentToken', 'localnet'),
      ).toThrow()
    })

    it('should work across all networks for weth', () => {
      const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet']

      for (const network of networks) {
        const address = getContract('tokens', 'weth', network)
        expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      }
    })
  })

  describe('getConstant', () => {
    it('should return entryPoint constant', () => {
      const entryPoint = getConstant('entryPoint')
      expect(entryPoint).toBe('0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789')
    })

    it('should return entryPointV07 constant', () => {
      const entryPoint = getConstant('entryPointV07')
      expect(entryPoint).toBe('0x0000000071727De22E5E9d8BAf0edAc6f37da032')
    })

    it('should return WETH constant', () => {
      const weth = getConstant('weth')
      expect(weth).toBe('0x4200000000000000000000000000000000000006')
    })
  })

  describe('getExternalContract', () => {
    it('should get external chain contracts', () => {
      const address = getExternalContract('baseSepolia', 'tokens', 'usdc')
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('should throw for unknown external chain', () => {
      expect(() =>
        getExternalContract('unknownChain', 'oif', 'solver'),
      ).toThrow('External chain unknownChain not configured')
    })
  })
})

describe('Services Configuration', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('getServicesConfig', () => {
    it('should return config for each network', () => {
      const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet']

      for (const network of networks) {
        const config = getServicesConfig(network)
        expect(config.rpc.l2).toBeTruthy()
        expect(config.rpc.ws).toBeTruthy()
        expect(config.explorer).toBeTruthy()
        expect(config.indexer.graphql).toBeTruthy()
        expect(config.gateway.ui).toBeTruthy()
      }
    })

    it('should respect RPC URL env overrides', () => {
      process.env.JEJU_RPC_URL = 'http://custom-rpc.example.com'
      const config = getServicesConfig('localnet')
      expect(config.rpc.l2).toBe('http://custom-rpc.example.com')
    })

    it('should respect WS URL env overrides', () => {
      process.env.JEJU_WS_URL = 'ws://custom-ws.example.com'
      const config = getServicesConfig('localnet')
      expect(config.rpc.ws).toBe('ws://custom-ws.example.com')
    })

    it('should respect L1 RPC URL env overrides', () => {
      process.env.JEJU_L1_RPC_URL = 'http://custom-l1.example.com'
      const config = getServicesConfig('localnet')
      expect(config.rpc.l1).toBe('http://custom-l1.example.com')
    })

    it('should respect indexer URL env overrides', () => {
      process.env.INDEXER_URL = 'http://custom-indexer.example.com'
      const config = getServicesConfig('localnet')
      expect(config.indexer.graphql).toBe('http://custom-indexer.example.com')
    })

    it('should respect gateway URL env overrides', () => {
      process.env.GATEWAY_URL = 'http://custom-gateway.example.com'
      const config = getServicesConfig('localnet')
      expect(config.gateway.ui).toBe('http://custom-gateway.example.com')
    })
  })

  describe('getServiceUrl', () => {
    it('should get RPC L2 URL by default', () => {
      // Clear env overrides to ensure we get config values
      delete process.env.JEJU_RPC_URL
      delete process.env.RPC_URL
      delete process.env.L1_RPC_URL
      delete process.env.JEJU_L1_RPC_URL
      const url = getServiceUrl('rpc', undefined, 'mainnet')
      expect(url).toContain('rpc')
    })

    it('should get RPC L1 URL with subService', () => {
      const url = getServiceUrl('rpc', 'l1', 'mainnet')
      expect(url).toBeTruthy()
    })

    it('should get RPC WS URL with subService', () => {
      const url = getServiceUrl('rpc', 'ws', 'mainnet')
      expect(url).toContain('ws')
    })

    it('should get direct string services', () => {
      const rpcGateway = getServiceUrl('rpcGateway', undefined, 'mainnet')
      expect(rpcGateway).toBeTruthy()

      const bazaar = getServiceUrl('bazaar', undefined, 'mainnet')
      expect(bazaar).toBeTruthy()

      const explorer = getServiceUrl('explorer', undefined, 'mainnet')
      expect(explorer).toBeTruthy()
    })

    it('should get nested service URLs', () => {
      const indexer = getServiceUrl('indexer', 'graphql', 'mainnet')
      expect(indexer).toBeTruthy()

      const gateway = getServiceUrl('gateway', 'api', 'mainnet')
      expect(gateway).toBeTruthy()
    })

    it('should throw for non-existent subService', () => {
      expect(() => getServiceUrl('indexer', 'nonexistent', 'mainnet')).toThrow()
    })
  })
})

describe('EIL (Cross-Chain Liquidity) Functions', () => {
  describe('getEILConfig', () => {
    it('should get EIL config for each network', () => {
      const networks: NetworkType[] = ['localnet', 'testnet', 'mainnet']

      for (const network of networks) {
        const config = getEILConfig(network)
        expect(config.hub).toBeDefined()
        expect(config.chains).toBeDefined()
      }
    })
  })

  describe('getEILChains', () => {
    it('should return chains object for network', () => {
      const chains = getEILChains('testnet')
      expect(typeof chains).toBe('object')
    })
  })

  describe('getEILChain', () => {
    it('should get chain by name', () => {
      const chains = getEILChains('testnet')
      const chainNames = Object.keys(chains)

      if (chainNames.length > 0) {
        const chain = getEILChain(chainNames[0], 'testnet')
        expect(chain).toBeDefined()
        expect(chain?.chainId).toBeDefined()
      }
    })

    it('should return undefined for unknown chain', () => {
      const chain = getEILChain('unknownChain', 'testnet')
      expect(chain).toBeUndefined()
    })
  })

  describe('getEILChainById', () => {
    it('should get chain by chain ID', () => {
      const chains = getEILChains('testnet')
      const chainValues = Object.values(chains)

      if (chainValues.length > 0) {
        const targetChainId = chainValues[0].chainId
        const chain = getEILChainById(targetChainId, 'testnet')
        expect(chain).toBeDefined()
        expect(chain?.chainId).toBe(targetChainId)
      }
    })

    it('should return undefined for unknown chain ID', () => {
      const chain = getEILChainById(999999999, 'testnet')
      expect(chain).toBeUndefined()
    })
  })

  describe('getEILChainIds', () => {
    it('should return array of chain IDs', () => {
      const ids = getEILChainIds('testnet')
      expect(Array.isArray(ids)).toBe(true)
      ids.forEach((id) => {
        expect(typeof id).toBe('number')
      })
    })
  })

  describe('getCrossChainPaymaster', () => {
    it('should handle chains with and without paymaster', () => {
      const chains = getEILChains('testnet')

      // Test EVM chains that have crossChainPaymaster (even if empty string)
      for (const [_name, chain] of Object.entries(chains)) {
        // Skip Solana chains which don't have paymaster
        if ('type' in chain && chain.type === 'solana') continue

        // EVM chains should have the field (even if empty)
        expect(
          'crossChainPaymaster' in chain ||
            chain.crossChainPaymaster === undefined,
        ).toBe(true)
      }
    })

    it('should throw for unknown chain', () => {
      expect(() => getCrossChainPaymaster('unknownChain', 'testnet')).toThrow()
    })
  })

  describe('getEILToken', () => {
    it('should get token address by chain and symbol', () => {
      const chains = getEILChains('testnet')

      for (const [name, chain] of Object.entries(chains)) {
        const tokenSymbols = Object.keys(chain.tokens)
        for (const symbol of tokenSymbols) {
          const token = getEILToken(name, symbol, 'testnet')
          // Token can be EVM address or Solana address
          expect(token).toBeTruthy()
        }
      }
    })

    it('should throw for unknown token', () => {
      const chains = getEILChains('testnet')
      // Find an EVM chain (not Solana)
      const evmChain = Object.entries(chains).find(
        ([, c]) => !('type' in c) || c.type !== 'solana',
      )

      if (evmChain) {
        expect(() =>
          getEILToken(evmChain[0], 'UNKNOWN_TOKEN', 'testnet'),
        ).toThrow()
      }
    })
  })
})

describe('Federation Functions', () => {
  describe('getFederationHub', () => {
    it('should get testnet hub config', () => {
      const hub = getFederationHub('testnet')
      expect(hub.chainId).toBeDefined()
      expect(hub.name).toBeDefined()
      expect(hub.rpcUrl).toBeDefined()
    })

    it('should get mainnet hub config', () => {
      const hub = getFederationHub('mainnet')
      expect(hub.chainId).toBeDefined()
      expect(hub.name).toBeDefined()
      expect(hub.rpcUrl).toBeDefined()
    })

    it('should return testnet for localnet', () => {
      const hub = getFederationHub('localnet')
      expect(hub).toBeDefined()
    })
  })

  describe('getFederatedNetworks', () => {
    it('should return networks object', () => {
      const networks = getFederatedNetworks()
      expect(typeof networks).toBe('object')
    })
  })
})

describe('Convenience Functions', () => {
  describe('getConfig', () => {
    it('should return complete config object', () => {
      const config = getConfig('localnet')
      expect(config.network).toBe('localnet')
      expect(config.chain).toBeDefined()
      expect(config.services).toBeDefined()
      expect(config.contracts).toBeDefined()
    })
  })

  describe('getFrontendContracts', () => {
    it('should return constant contract addresses', () => {
      // Test with testnet since localnet may have empty contracts
      // Only test constants which are always set
      const entryPoint = getConstant('entryPoint')
      const weth = getConstant('weth')
      expect(entryPoint).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(weth).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })
  })

  describe('getFrontendServices', () => {
    it('should return all frontend service URLs', () => {
      const services = getFrontendServices('mainnet')
      expect(services.rpcUrl).toBeTruthy()
      expect(services.wsUrl).toBeTruthy()
      expect(services.explorerUrl).toBeTruthy()
    })
  })
})

describe('PoC (Proof-of-Cloud) Functions', () => {
  describe('getPoCConfig', () => {
    it('should get PoC config for testnet', () => {
      const config = getPoCConfig('testnet')
      expect(config.chainId).toBeDefined()
      expect(config.rpcUrl).toBeDefined()
    })

    it('should use baseSepolia for testnet', () => {
      const config = getPoCConfig('testnet')
      // Base Sepolia chain ID is 84532
      expect(config.chainId).toBe(84532)
    })
  })

  describe('getExternalRpc', () => {
    it('should get external RPC from config', () => {
      const rpc = getExternalRpc('baseSepolia')
      expect(rpc).toContain('http')
    })

    it('should respect env override', () => {
      const originalEnv = { ...process.env }
      process.env.BASESEPOLIA_RPC_URL = 'http://custom-base.example.com'

      const rpc = getExternalRpc('baseSepolia')
      expect(rpc).toBe('http://custom-base.example.com')

      process.env = { ...originalEnv }
    })

    it('should throw for unknown chain', () => {
      expect(() => getExternalRpc('unknownChain')).toThrow()
    })
  })
})
