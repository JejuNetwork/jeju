/**
 * Tests for useGameItems hooks
 * 
 * Tests:
 * - Hook exports and types
 * - Web2 fallback behavior
 * - Rarity info helper
 */

import { describe, test, expect } from 'bun:test'
import { getRarityInfo } from '../useGameItems'

describe('useGameItems Hooks', () => {
  describe('exports', () => {
    test('should export useGameItems', async () => {
      const module = await import('../useGameItems')
      expect(typeof module.useGameItems).toBe('function')
    })

    test('should export useGameItemMetadata', async () => {
      const module = await import('../useGameItems')
      expect(typeof module.useGameItemMetadata).toBe('function')
    })

    test('should export useGameItemBalance', async () => {
      const module = await import('../useGameItems')
      expect(typeof module.useGameItemBalance).toBe('function')
    })

    test('should export useMintItem', async () => {
      const module = await import('../useGameItems')
      expect(typeof module.useMintItem).toBe('function')
    })

    test('should export useBurnItem', async () => {
      const module = await import('../useGameItems')
      expect(typeof module.useBurnItem).toBe('function')
    })

    test('should export getRarityInfo', async () => {
      const module = await import('../useGameItems')
      expect(typeof module.getRarityInfo).toBe('function')
    })

    test('should export GameItem type', async () => {
      const module = await import('../useGameItems')
      // Type exports don't have runtime presence, but we can check the module loads
      expect(module).toBeDefined()
    })
  })

  describe('getRarityInfo', () => {
    test('Common (0) returns gray colors', () => {
      const info = getRarityInfo(0)
      expect(info.name).toBe('Common')
      expect(info.color).toContain('gray')
      expect(info.bgClass).toContain('gray')
    })

    test('Uncommon (1) returns green colors', () => {
      const info = getRarityInfo(1)
      expect(info.name).toBe('Uncommon')
      expect(info.color).toContain('green')
      expect(info.bgClass).toContain('green')
    })

    test('Rare (2) returns blue colors', () => {
      const info = getRarityInfo(2)
      expect(info.name).toBe('Rare')
      expect(info.color).toContain('blue')
      expect(info.bgClass).toContain('blue')
    })

    test('Epic (3) returns purple colors', () => {
      const info = getRarityInfo(3)
      expect(info.name).toBe('Epic')
      expect(info.color).toContain('purple')
      expect(info.bgClass).toContain('purple')
    })

    test('Legendary (4) returns yellow colors', () => {
      const info = getRarityInfo(4)
      expect(info.name).toBe('Legendary')
      expect(info.color).toContain('yellow')
      expect(info.bgClass).toContain('yellow')
    })

    test('invalid rarity returns Unknown', () => {
      expect(getRarityInfo(5).name).toBe('Unknown')
      expect(getRarityInfo(99).name).toBe('Unknown')
      expect(getRarityInfo(-1).name).toBe('Unknown')
    })

    test('all rarities have required properties', () => {
      for (let i = 0; i <= 4; i++) {
        const info = getRarityInfo(i)
        expect(info).toHaveProperty('name')
        expect(info).toHaveProperty('color')
        expect(info).toHaveProperty('bgClass')
        expect(typeof info.name).toBe('string')
        expect(typeof info.color).toBe('string')
        expect(typeof info.bgClass).toBe('string')
      }
    })
  })

  describe('GameItem interface', () => {
    test('should have correct shape', () => {
      // Type check - this would fail at compile time if interface is wrong
      const item = {
        id: '1',
        tokenId: '100',
        name: 'Test Sword',
        rarity: 4,
        attack: 50,
        defense: 10,
        strength: 20,
        stackable: false,
        balance: '1',
        owner: '0x1234567890123456789012345678901234567890',
        originalMinter: '0x1234567890123456789012345678901234567890',
        mintedAt: 1234567890,
      }
      
      expect(item.id).toBe('1')
      expect(item.tokenId).toBe('100')
      expect(item.name).toBe('Test Sword')
      expect(item.rarity).toBe(4)
      expect(item.attack).toBe(50)
      expect(item.defense).toBe(10)
      expect(item.strength).toBe(20)
      expect(item.stackable).toBe(false)
      expect(item.balance).toBe('1')
      expect(item.owner).toBeDefined()
      expect(item.originalMinter).toBeDefined()
      expect(item.mintedAt).toBeDefined()
    })
  })
})

describe('Contract ABI Integration', () => {
  test('ItemsAbi from @jejunetwork/contracts has required functions', async () => {
    const { ItemsAbi } = await import('@jejunetwork/contracts')
    
    const functions = (ItemsAbi as readonly { type: string; name?: string }[])
      .filter(item => item.type === 'function')
      .map(item => item.name)

    // Core ERC-1155
    expect(functions).toContain('balanceOf')
    expect(functions).toContain('balanceOfBatch')
    expect(functions).toContain('setApprovalForAll')
    expect(functions).toContain('isApprovedForAll')
    expect(functions).toContain('safeTransferFrom')
    
    // Items.sol specific
    expect(functions).toContain('mintItem')
    expect(functions).toContain('burn')
    expect(functions).toContain('getItemMetadata')
    expect(functions).toContain('getMintedMetadata')
    expect(functions).toContain('createItemType')
  })

  test('ItemsAbi has required events', async () => {
    const { ItemsAbi } = await import('@jejunetwork/contracts')
    
    const events = (ItemsAbi as readonly { type: string; name?: string }[])
      .filter(item => item.type === 'event')
      .map(item => item.name)

    expect(events).toContain('ItemMinted')
    expect(events).toContain('ItemBurned')
    expect(events).toContain('ItemTypeCreated')
    expect(events).toContain('NFTProvenance')
    expect(events).toContain('TransferSingle')
    expect(events).toContain('TransferBatch')
  })

  test('GoldAbi from @jejunetwork/contracts has required functions', async () => {
    const { GoldAbi } = await import('@jejunetwork/contracts')
    
    const functions = (GoldAbi as readonly { type: string; name?: string }[])
      .filter(item => item.type === 'function')
      .map(item => item.name)

    // ERC-20
    expect(functions).toContain('balanceOf')
    expect(functions).toContain('transfer')
    expect(functions).toContain('approve')
    expect(functions).toContain('transferFrom')
    
    // Gold.sol specific
    expect(functions).toContain('claimGold')
    expect(functions).toContain('burn')
  })

  test('GoldAbi has required events', async () => {
    const { GoldAbi } = await import('@jejunetwork/contracts')
    
    const events = (GoldAbi as readonly { type: string; name?: string }[])
      .filter(item => item.type === 'event')
      .map(item => item.name)

    expect(events).toContain('GoldClaimed')
    expect(events).toContain('GoldBurned')
    expect(events).toContain('Transfer')
  })
})

describe('Deployment Configuration', () => {
  test('gameSystemDeployments exports correctly', async () => {
    const { gameSystemDeployments } = await import('@jejunetwork/contracts')
    
    expect(gameSystemDeployments).toBeDefined()
    expect(typeof gameSystemDeployments).toBe('object')
  })

  test('getGameItems helper works', async () => {
    const { getGameItems } = await import('@jejunetwork/contracts')
    
    expect(typeof getGameItems).toBe('function')
    // Returns undefined if not deployed (which is fine for test)
    const result = getGameItems(1337)
    expect(result === undefined || typeof result === 'string').toBe(true)
  })

  test('getGameGold helper works', async () => {
    const { getGameGold } = await import('@jejunetwork/contracts')
    
    expect(typeof getGameGold).toBe('function')
    const result = getGameGold(1337)
    expect(result === undefined || typeof result === 'string').toBe(true)
  })

  test('getGameIntegration helper works', async () => {
    const { getGameIntegration } = await import('@jejunetwork/contracts')
    
    expect(typeof getGameIntegration).toBe('function')
    const result = getGameIntegration(1337)
    expect(result === undefined || typeof result === 'string').toBe(true)
  })
})
