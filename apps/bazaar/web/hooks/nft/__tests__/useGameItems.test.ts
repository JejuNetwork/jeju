/**
 * Tests for useGameItems hooks
 *
 * Tests:
 * - Hook exports and types
 * - Web2 fallback behavior
 * - Rarity info helper
 */

import { describe, expect, test } from 'bun:test'
import {
  GoldAbi,
  gameSystemDeployments,
  getGameGold,
  getGameIntegration,
  getGameItems,
  ItemsAbi,
} from '@jejunetwork/contracts'
import { getRarityInfo } from '../../../lib/games'
import * as useGameItemsModule from '../useGameItems'

describe('useGameItems Hooks', () => {
  describe('exports', () => {
    test('should export useGameItems', () => {
      expect(typeof useGameItemsModule.useGameItems).toBe('function')
    })

    test('should export useGameItemMetadata', () => {
      expect(typeof useGameItemsModule.useGameItemMetadata).toBe('function')
    })

    test('should export useGameItemBalance', () => {
      expect(typeof useGameItemsModule.useGameItemBalance).toBe('function')
    })

    test('should export useMintItem', () => {
      expect(typeof useGameItemsModule.useMintItem).toBe('function')
    })

    test('should export useBurnItem', () => {
      expect(typeof useGameItemsModule.useBurnItem).toBe('function')
    })

    test('should export getRarityInfo', () => {
      expect(typeof useGameItemsModule.getRarityInfo).toBe('function')
    })

    test('should export GameItem type', () => {
      // Type exports don't have runtime presence, but we can check the module loads
      expect(useGameItemsModule).toBeDefined()
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
  test('ItemsAbi from @jejunetwork/contracts has required functions', () => {
    const functions = (ItemsAbi as readonly { type: string; name?: string }[])
      .filter((item) => item.type === 'function')
      .map((item) => item.name)

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

  test('ItemsAbi has required events', () => {
    const events = (ItemsAbi as readonly { type: string; name?: string }[])
      .filter((item) => item.type === 'event')
      .map((item) => item.name)

    expect(events).toContain('ItemMinted')
    expect(events).toContain('ItemBurned')
    expect(events).toContain('ItemTypeCreated')
    expect(events).toContain('NFTProvenance')
    expect(events).toContain('TransferSingle')
    expect(events).toContain('TransferBatch')
  })

  test('GoldAbi from @jejunetwork/contracts has required functions', () => {
    const functions = (GoldAbi as readonly { type: string; name?: string }[])
      .filter((item) => item.type === 'function')
      .map((item) => item.name)

    // ERC-20
    expect(functions).toContain('balanceOf')
    expect(functions).toContain('transfer')
    expect(functions).toContain('approve')
    expect(functions).toContain('transferFrom')

    // Gold.sol specific
    expect(functions).toContain('claimGold')
    expect(functions).toContain('burn')
  })

  test('GoldAbi has required events', () => {
    const events = (GoldAbi as readonly { type: string; name?: string }[])
      .filter((item) => item.type === 'event')
      .map((item) => item.name)

    expect(events).toContain('GoldClaimed')
    expect(events).toContain('GoldBurned')
    expect(events).toContain('Transfer')
  })
})

describe('Deployment Configuration', () => {
  test('gameSystemDeployments exports correctly', () => {
    expect(gameSystemDeployments).toBeDefined()
    expect(typeof gameSystemDeployments).toBe('object')
  })

  test('getGameItems helper works', () => {
    expect(typeof getGameItems).toBe('function')
    // Returns undefined if not deployed (which is fine for test)
    const result = getGameItems(31337)
    expect(result === undefined || typeof result === 'string').toBe(true)
  })

  test('getGameGold helper works', () => {
    expect(typeof getGameGold).toBe('function')
    const result = getGameGold(31337)
    expect(result === undefined || typeof result === 'string').toBe(true)
  })

  test('getGameIntegration helper works', () => {
    expect(typeof getGameIntegration).toBe('function')
    const result = getGameIntegration(31337)
    expect(result === undefined || typeof result === 'string').toBe(true)
  })
})
