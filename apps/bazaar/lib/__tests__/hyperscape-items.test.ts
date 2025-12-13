/**
 * Game Items Integration Tests
 * 
 * Tests for Items.sol (ERC-1155) integration in Bazaar
 * These tests work with any game that uses Jeju's canonical Items.sol contract
 */

import { describe, test, expect } from 'bun:test'
import { getRarityInfo } from '@/hooks/nft/useGameItems'

describe('Game Items', () => {
  describe('getRarityInfo', () => {
    test('should return correct info for Common (0)', () => {
      const info = getRarityInfo(0)
      expect(info.name).toBe('Common')
      expect(info.color).toContain('gray')
    })

    test('should return correct info for Uncommon (1)', () => {
      const info = getRarityInfo(1)
      expect(info.name).toBe('Uncommon')
      expect(info.color).toContain('green')
    })

    test('should return correct info for Rare (2)', () => {
      const info = getRarityInfo(2)
      expect(info.name).toBe('Rare')
      expect(info.color).toContain('blue')
    })

    test('should return correct info for Epic (3)', () => {
      const info = getRarityInfo(3)
      expect(info.name).toBe('Epic')
      expect(info.color).toContain('purple')
    })

    test('should return correct info for Legendary (4)', () => {
      const info = getRarityInfo(4)
      expect(info.name).toBe('Legendary')
      expect(info.color).toContain('yellow')
    })

    test('should return Unknown for invalid rarity', () => {
      const info = getRarityInfo(99)
      expect(info.name).toBe('Unknown')
    })
  })

  describe('Items.sol ABI (from @jejunetwork/contracts)', () => {
    test('should have required functions', async () => {
      const { ItemsAbi } = await import('@jejunetwork/contracts')
      
      const functionNames = (ItemsAbi as readonly {type: string, name?: string}[])
        .filter((item) => item.type === 'function')
        .map((item) => item.name)

      // Core ERC-1155 functions
      expect(functionNames).toContain('balanceOf')
      expect(functionNames).toContain('balanceOfBatch')
      expect(functionNames).toContain('setApprovalForAll')
      expect(functionNames).toContain('safeTransferFrom')
      
      // Items.sol specific functions
      expect(functionNames).toContain('getItemMetadata')
      expect(functionNames).toContain('getMintedMetadata')
      expect(functionNames).toContain('mintItem')
      expect(functionNames).toContain('burn')
      expect(functionNames).toContain('createItemType')
      expect(functionNames).toContain('gameSigner')
      expect(functionNames).toContain('gameAgentId')
    })

    test('should have required events', async () => {
      const { ItemsAbi } = await import('@jejunetwork/contracts')
      
      const eventNames = (ItemsAbi as readonly {type: string, name?: string}[])
        .filter((item) => item.type === 'event')
        .map((item) => item.name)

      expect(eventNames).toContain('ItemMinted')
      expect(eventNames).toContain('ItemBurned')
      expect(eventNames).toContain('ItemTypeCreated')
      expect(eventNames).toContain('NFTProvenance')
      expect(eventNames).toContain('TransferSingle')
    })

    test('mintItem should have correct signature', async () => {
      const { ItemsAbi } = await import('@jejunetwork/contracts')
      
      const mintItem = (ItemsAbi as readonly {type: string, name?: string, inputs?: {name: string, type: string}[]}[])
        .find((item) => item.name === 'mintItem')
      
      expect(mintItem).toBeDefined()
      expect(mintItem!.inputs).toBeDefined()
      
      const inputNames = mintItem!.inputs!.map(i => i.name)
      expect(inputNames).toContain('itemId')
      expect(inputNames).toContain('amount')
      expect(inputNames).toContain('instanceId')
      expect(inputNames).toContain('signature')
    })

    test('getItemMetadata should return proper struct', async () => {
      const { ItemsAbi } = await import('@jejunetwork/contracts')
      
      const getItemMetadata = (ItemsAbi as readonly {type: string, name?: string, outputs?: {type: string, components?: {name: string}[]}[]}[])
        .find((item) => item.name === 'getItemMetadata')
      
      expect(getItemMetadata).toBeDefined()
      expect(getItemMetadata!.outputs).toBeDefined()
      expect(getItemMetadata!.outputs![0].type).toBe('tuple')
      
      const componentNames = getItemMetadata!.outputs![0].components!.map(c => c.name)
      expect(componentNames).toContain('itemId')
      expect(componentNames).toContain('name')
      expect(componentNames).toContain('stackable')
      expect(componentNames).toContain('attack')
      expect(componentNames).toContain('defense')
      expect(componentNames).toContain('strength')
      expect(componentNames).toContain('rarity')
    })
  })

  describe('Gold.sol ABI (from @jejunetwork/contracts)', () => {
    test('should have required functions', async () => {
      const { GoldAbi } = await import('@jejunetwork/contracts')
      
      const functionNames = (GoldAbi as readonly {type: string, name?: string}[])
        .filter((item) => item.type === 'function')
        .map((item) => item.name)

      // Core ERC-20 functions
      expect(functionNames).toContain('balanceOf')
      expect(functionNames).toContain('transfer')
      expect(functionNames).toContain('approve')
      expect(functionNames).toContain('transferFrom')
      expect(functionNames).toContain('totalSupply')
      
      // Gold.sol specific functions
      expect(functionNames).toContain('claimGold')
      expect(functionNames).toContain('burn')
      expect(functionNames).toContain('gameSigner')
      expect(functionNames).toContain('gameAgentId')
      expect(functionNames).toContain('getNonce')
    })

    test('should have required events', async () => {
      const { GoldAbi } = await import('@jejunetwork/contracts')
      
      const eventNames = (GoldAbi as readonly {type: string, name?: string}[])
        .filter((item) => item.type === 'event')
        .map((item) => item.name)

      expect(eventNames).toContain('GoldClaimed')
      expect(eventNames).toContain('GoldBurned')
      expect(eventNames).toContain('Transfer')
      expect(eventNames).toContain('Approval')
    })

    test('claimGold should have correct signature', async () => {
      const { GoldAbi } = await import('@jejunetwork/contracts')
      
      const claimGold = (GoldAbi as readonly {type: string, name?: string, inputs?: {name: string, type: string}[]}[])
        .find((item) => item.name === 'claimGold')
      
      expect(claimGold).toBeDefined()
      expect(claimGold!.inputs).toBeDefined()
      
      const inputNames = claimGold!.inputs!.map(i => i.name)
      expect(inputNames).toContain('amount')
      expect(inputNames).toContain('nonce')
      expect(inputNames).toContain('signature')
    })
  })

  describe('NFT Marketplace Integration', () => {
    test('NFTMarketplace ABI should have listing functions', async () => {
      const abi = await import('@/lib/abis/NFTMarketplace.json')
      
      const functionNames = abi.default
        .filter((item: { type: string }) => item.type === 'function')
        .map((item: { name: string }) => item.name)

      // Listing functions
      expect(functionNames).toContain('createListing')
      expect(functionNames).toContain('cancelListing')
      expect(functionNames).toContain('buyListing')
      expect(functionNames).toContain('getListing')
      
      // Auction functions
      expect(functionNames).toContain('createAuction')
      expect(functionNames).toContain('placeBid')
      expect(functionNames).toContain('settleAuction')
      expect(functionNames).toContain('getAuction')
      
      // Offer functions
      expect(functionNames).toContain('makeOffer')
      expect(functionNames).toContain('acceptOffer')
    })
  })

  describe('ERC20 Factory Integration', () => {
    test('SimpleERC20Factory ABI should have token creation', async () => {
      const abi = await import('@/lib/abis/SimpleERC20Factory.json')
      
      const functionNames = abi.default
        .filter((item: { type: string }) => item.type === 'function')
        .map((item: { name: string }) => item.name)

      expect(functionNames).toContain('createToken')
      expect(functionNames).toContain('getCreatorTokens')
      expect(functionNames).toContain('tokenCount')
      expect(functionNames).toContain('getAllTokens')
    })

    test('createToken should have correct parameters', async () => {
      const abi = await import('@/lib/abis/SimpleERC20Factory.json')
      
      const createToken = abi.default.find(
        (item: { name?: string }) => item.name === 'createToken'
      ) as { name: string; inputs: { name: string }[] } | undefined
      
      expect(createToken).toBeDefined()
      if (!createToken) throw new Error('createToken not found')
      
      expect(createToken.inputs).toHaveLength(4)
      
      const inputNames = createToken.inputs.map((i: { name: string }) => i.name)
      expect(inputNames).toContain('name')
      expect(inputNames).toContain('symbol')
      expect(inputNames).toContain('decimals')
      expect(inputNames).toContain('initialSupply')
    })
  })
})

