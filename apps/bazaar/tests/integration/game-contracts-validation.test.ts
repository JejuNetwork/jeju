/**
 * Game Contracts On-Chain Validation Tests
 * 
 * These tests validate that deployed game contracts (Items.sol, Gold.sol)
 * are functioning correctly on-chain.
 * 
 * Requires: Localnet running with deployed contracts
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import { createPublicClient, http, type Address } from 'viem'
import { localhost } from 'viem/chains'
import { 
  ItemsAbi, 
  GoldAbi, 
  getGameItems, 
  getGameGold,
  getGameIntegration,
  GameIntegrationAbi,
} from '@jejunetwork/contracts'

const LOCALNET_RPC = process.env.LOCALNET_RPC || 'http://localhost:8545'
const CHAIN_ID = 1337

// Skip if no localnet
const hasLocalnet = async () => {
  try {
    const response = await fetch(LOCALNET_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
    })
    return response.ok
  } catch {
    return false
  }
}

describe('Game Contracts On-Chain Validation', () => {
  let client: ReturnType<typeof createPublicClient>
  let itemsAddress: Address | undefined
  let goldAddress: Address | undefined
  let gameIntegrationAddress: Address | undefined
  let localnetAvailable = false

  beforeAll(async () => {
    localnetAvailable = await hasLocalnet()
    
    if (!localnetAvailable) {
      console.log('⚠️ Localnet not available, skipping on-chain tests')
      return
    }

    client = createPublicClient({
      chain: localhost,
      transport: http(LOCALNET_RPC),
    })

    itemsAddress = getGameItems(CHAIN_ID) as Address | undefined
    goldAddress = getGameGold(CHAIN_ID) as Address | undefined
    gameIntegrationAddress = getGameIntegration(CHAIN_ID) as Address | undefined
  })

  describe('Items.sol Contract', () => {
    test('should have bytecode deployed', async () => {
      if (!localnetAvailable || !itemsAddress) {
        console.log('⏭️ Skipping: Items contract not deployed')
        return
      }

      const bytecode = await client.getBytecode({ address: itemsAddress })
      expect(bytecode).toBeDefined()
      expect(bytecode!.length).toBeGreaterThan(2) // '0x' + bytecode
    })

    test('should return valid gameSigner', async () => {
      if (!localnetAvailable || !itemsAddress) return

      const signer = await client.readContract({
        address: itemsAddress,
        abi: ItemsAbi,
        functionName: 'gameSigner',
      })

      expect(signer).toBeDefined()
      expect(typeof signer).toBe('string')
      expect((signer as string).length).toBe(42) // Valid address
    })

    test('should return valid gameAgentId', async () => {
      if (!localnetAvailable || !itemsAddress) return

      const agentId = await client.readContract({
        address: itemsAddress,
        abi: ItemsAbi,
        functionName: 'gameAgentId',
      })

      expect(agentId).toBeDefined()
      expect(typeof agentId).toBe('bigint')
    })

    test('should support ERC-1155 interface', async () => {
      if (!localnetAvailable || !itemsAddress) return

      // ERC-1155 interface ID: 0xd9b67a26
      const supportsERC1155 = await client.readContract({
        address: itemsAddress,
        abi: ItemsAbi,
        functionName: 'supportsInterface',
        args: ['0xd9b67a26'],
      })

      expect(supportsERC1155).toBe(true)
    })

    test('should have valid URI', async () => {
      if (!localnetAvailable || !itemsAddress) return

      const uri = await client.readContract({
        address: itemsAddress,
        abi: ItemsAbi,
        functionName: 'uri',
        args: [0n],
      })

      expect(uri).toBeDefined()
      expect(typeof uri).toBe('string')
    })
  })

  describe('Gold.sol Contract', () => {
    let goldDeployed = false

    beforeAll(async () => {
      if (!localnetAvailable || !goldAddress) return
      try {
        const bytecode = await client.getBytecode({ address: goldAddress })
        goldDeployed = !!bytecode && bytecode.length > 2
      } catch {
        goldDeployed = false
      }
    })

    test('should have bytecode deployed', async () => {
      if (!localnetAvailable || !goldAddress) {
        console.log('⏭️ Skipping: Gold contract not configured')
        return
      }
      if (!goldDeployed) {
        console.log('⏭️ Skipping: Gold contract not deployed on chain')
        return
      }

      const bytecode = await client.getBytecode({ address: goldAddress })
      expect(bytecode).toBeDefined()
      expect(bytecode!.length).toBeGreaterThan(2)
    })

    test('should return valid token name', async () => {
      if (!localnetAvailable || !goldAddress || !goldDeployed) return

      const name = await client.readContract({
        address: goldAddress,
        abi: GoldAbi,
        functionName: 'name',
      })

      expect(name).toBeDefined()
      expect(typeof name).toBe('string')
      expect((name as string).length).toBeGreaterThan(0)
    })

    test('should return valid token symbol', async () => {
      if (!localnetAvailable || !goldAddress || !goldDeployed) return

      const symbol = await client.readContract({
        address: goldAddress,
        abi: GoldAbi,
        functionName: 'symbol',
      })

      expect(symbol).toBeDefined()
      expect(typeof symbol).toBe('string')
    })

    test('should have 18 decimals', async () => {
      if (!localnetAvailable || !goldAddress || !goldDeployed) return

      const decimals = await client.readContract({
        address: goldAddress,
        abi: GoldAbi,
        functionName: 'decimals',
      })

      expect(decimals).toBe(18)
    })

    test('should return valid gameSigner', async () => {
      if (!localnetAvailable || !goldAddress || !goldDeployed) return

      const signer = await client.readContract({
        address: goldAddress,
        abi: GoldAbi,
        functionName: 'gameSigner',
      })

      expect(signer).toBeDefined()
      expect(typeof signer).toBe('string')
    })
  })

  describe('GameIntegration.sol Contract', () => {
    test('should have bytecode deployed', async () => {
      if (!localnetAvailable || !gameIntegrationAddress) {
        console.log('⏭️ Skipping: GameIntegration contract not deployed')
        return
      }

      const bytecode = await client.getBytecode({ address: gameIntegrationAddress })
      expect(bytecode).toBeDefined()
      expect(bytecode!.length).toBeGreaterThan(2)
    })

    test('should return connected contracts', async () => {
      if (!localnetAvailable || !gameIntegrationAddress) return

      // Check if Items contract is connected
      const itemsContract = await client.readContract({
        address: gameIntegrationAddress,
        abi: GameIntegrationAbi,
        functionName: 'itemsContract',
      })

      expect(itemsContract).toBeDefined()
      
      // Check if Gold contract is connected
      const goldContract = await client.readContract({
        address: gameIntegrationAddress,
        abi: GameIntegrationAbi,
        functionName: 'goldContract',
      })

      expect(goldContract).toBeDefined()
    })
  })

  describe('Cross-Contract Validation', () => {
    test('Items and Gold should share same gameSigner', async () => {
      if (!localnetAvailable || !itemsAddress || !goldAddress) return

      const itemsSigner = await client.readContract({
        address: itemsAddress,
        abi: ItemsAbi,
        functionName: 'gameSigner',
      })

      const goldSigner = await client.readContract({
        address: goldAddress,
        abi: GoldAbi,
        functionName: 'gameSigner',
      })

      expect(itemsSigner).toBe(goldSigner)
    })

    test('Items and Gold should share same gameAgentId', async () => {
      if (!localnetAvailable || !itemsAddress || !goldAddress) return

      const itemsAgentId = await client.readContract({
        address: itemsAddress,
        abi: ItemsAbi,
        functionName: 'gameAgentId',
      })

      const goldAgentId = await client.readContract({
        address: goldAddress,
        abi: GoldAbi,
        functionName: 'gameAgentId',
      })

      expect(itemsAgentId).toBe(goldAgentId)
    })
  })
})

describe('Web2 Fallback Validation', () => {
  test('hooks should work without chain connection', async () => {
    // This validates the web2 mode works correctly
    const { useGameItems, useMintItem, useBurnItem } = await import('@/hooks/nft/useGameItems')
    
    expect(typeof useGameItems).toBe('function')
    expect(typeof useMintItem).toBe('function')
    expect(typeof useBurnItem).toBe('function')
  })

  test('config should handle missing contracts gracefully', async () => {
    const { getGameContracts } = await import('@/config/contracts')
    
    // Should not throw for unknown chain
    const contracts = getGameContracts(999999)
    expect(contracts).toBeDefined()
    expect(typeof contracts).toBe('object')
  })
})
