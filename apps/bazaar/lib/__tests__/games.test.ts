/**
 * Game utilities unit tests
 */

import { describe, expect, test } from 'bun:test'
import type { GameItem } from '../../schemas/games'
import {
  calculateKDRatio,
  filterItemsByCategory,
  formatAddress,
  formatGameTimestamp,
  formatItemStats,
  formatXP,
  getItemCategory,
  getRarityInfo,
  getRarityName,
  hasCombatStats,
  isValidRarity,
  sortByBalance,
  sortByRarity,
} from '../games'

const createMockItem = (overrides: Partial<GameItem> = {}): GameItem => ({
  id: 'test-1',
  tokenId: '1',
  name: 'Test Item',
  rarity: 0,
  attack: 0,
  defense: 0,
  strength: 0,
  stackable: false,
  balance: '1',
  owner: '0x1234567890123456789012345678901234567890',
  ...overrides,
})

describe('getRarityInfo', () => {
  test('returns Common info for rarity 0', () => {
    const info = getRarityInfo(0)
    expect(info.name).toBe('Common')
    expect(info.color).toContain('gray')
    expect(info.bgClass).toContain('gray')
  })

  test('returns Uncommon info for rarity 1', () => {
    const info = getRarityInfo(1)
    expect(info.name).toBe('Uncommon')
    expect(info.color).toContain('green')
  })

  test('returns Rare info for rarity 2', () => {
    const info = getRarityInfo(2)
    expect(info.name).toBe('Rare')
    expect(info.color).toContain('blue')
  })

  test('returns Epic info for rarity 3', () => {
    const info = getRarityInfo(3)
    expect(info.name).toBe('Epic')
    expect(info.color).toContain('purple')
  })

  test('returns Legendary info for rarity 4', () => {
    const info = getRarityInfo(4)
    expect(info.name).toBe('Legendary')
    expect(info.color).toContain('yellow')
  })

  test('returns Unknown for invalid rarity', () => {
    expect(getRarityInfo(-1).name).toBe('Unknown')
    expect(getRarityInfo(5).name).toBe('Unknown')
    expect(getRarityInfo(100).name).toBe('Unknown')
  })
})

describe('getRarityName', () => {
  test('returns correct name for each rarity', () => {
    expect(getRarityName(0)).toBe('Common')
    expect(getRarityName(1)).toBe('Uncommon')
    expect(getRarityName(2)).toBe('Rare')
    expect(getRarityName(3)).toBe('Epic')
    expect(getRarityName(4)).toBe('Legendary')
  })
})

describe('isValidRarity', () => {
  test('returns true for valid rarities (0-4)', () => {
    expect(isValidRarity(0)).toBe(true)
    expect(isValidRarity(1)).toBe(true)
    expect(isValidRarity(2)).toBe(true)
    expect(isValidRarity(3)).toBe(true)
    expect(isValidRarity(4)).toBe(true)
  })

  test('returns false for invalid rarities', () => {
    expect(isValidRarity(-1)).toBe(false)
    expect(isValidRarity(5)).toBe(false)
    expect(isValidRarity(100)).toBe(false)
  })
})

describe('getItemCategory', () => {
  test('categorizes weapons by attack stat', () => {
    const weapon = createMockItem({ attack: 10, defense: 0 })
    expect(getItemCategory(weapon)).toBe('weapons')
  })

  test('categorizes armor by defense stat', () => {
    const armor = createMockItem({ defense: 10, attack: 0 })
    expect(getItemCategory(armor)).toBe('armor')
  })

  test('categorizes stackable items without combat stats as resources', () => {
    const resource = createMockItem({ stackable: true, attack: 0, defense: 0 })
    expect(getItemCategory(resource)).toBe('resources')
  })

  test('categorizes by name keywords', () => {
    const sword = createMockItem({ name: 'Iron Sword' })
    expect(getItemCategory(sword)).toBe('weapons')

    const helmet = createMockItem({ name: 'Steel Helmet' })
    expect(getItemCategory(helmet)).toBe('armor')

    const pickaxe = createMockItem({ name: 'Bronze Pickaxe' })
    expect(getItemCategory(pickaxe)).toBe('tools')

    const logs = createMockItem({ name: 'Oak Logs' })
    expect(getItemCategory(logs)).toBe('resources')
  })
})

describe('filterItemsByCategory', () => {
  const items: GameItem[] = [
    createMockItem({ id: '1', name: 'Iron Sword', attack: 10 }),
    createMockItem({ id: '2', name: 'Steel Helmet', defense: 5 }),
    createMockItem({ id: '3', name: 'Oak Logs', stackable: true }),
    createMockItem({ id: '4', name: 'Random Item' }),
  ]

  test('returns all items for "all" category', () => {
    const result = filterItemsByCategory(items, 'all')
    expect(result).toHaveLength(4)
  })

  test('filters weapons correctly', () => {
    const result = filterItemsByCategory(items, 'weapons')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Iron Sword')
  })

  test('filters armor correctly', () => {
    const result = filterItemsByCategory(items, 'armor')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Steel Helmet')
  })

  test('filters resources correctly', () => {
    const result = filterItemsByCategory(items, 'resources')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Oak Logs')
  })
})

describe('formatItemStats', () => {
  test('returns empty array for items without combat stats', () => {
    const item = createMockItem()
    expect(formatItemStats(item)).toHaveLength(0)
  })

  test('formats attack stat', () => {
    const item = createMockItem({ attack: 10 })
    const stats = formatItemStats(item)
    expect(stats).toContain('⚔️ Attack: +10')
  })

  test('formats defense stat', () => {
    const item = createMockItem({ defense: 5 })
    const stats = formatItemStats(item)
    expect(stats).toContain('🛡️ Defense: +5')
  })

  test('formats strength stat', () => {
    const item = createMockItem({ strength: 8 })
    const stats = formatItemStats(item)
    expect(stats).toContain('💪 Strength: +8')
  })

  test('formats multiple stats', () => {
    const item = createMockItem({ attack: 10, defense: 5, strength: 3 })
    const stats = formatItemStats(item)
    expect(stats).toHaveLength(3)
  })
})

describe('hasCombatStats', () => {
  test('returns false for item without combat stats', () => {
    const item = createMockItem()
    expect(hasCombatStats(item)).toBe(false)
  })

  test('returns true for item with attack', () => {
    const item = createMockItem({ attack: 10 })
    expect(hasCombatStats(item)).toBe(true)
  })

  test('returns true for item with defense', () => {
    const item = createMockItem({ defense: 5 })
    expect(hasCombatStats(item)).toBe(true)
  })

  test('returns true for item with strength', () => {
    const item = createMockItem({ strength: 8 })
    expect(hasCombatStats(item)).toBe(true)
  })
})

describe('formatAddress', () => {
  const testAddress = '0x1234567890abcdef1234567890abcdef12345678'

  test('truncates address with default settings', () => {
    expect(formatAddress(testAddress)).toBe('0x1234...5678')
  })

  test('uses custom start and end chars', () => {
    expect(formatAddress(testAddress, 10, 6)).toBe('0x12345678...345678')
  })

  test('returns full address if too short', () => {
    expect(formatAddress('0x1234', 6, 4)).toBe('0x1234')
  })
})

describe('formatGameTimestamp', () => {
  test('formats ISO timestamp to locale time', () => {
    const timestamp = '2024-01-15T14:30:00Z'
    const formatted = formatGameTimestamp(timestamp)
    expect(typeof formatted).toBe('string')
    expect(formatted.length).toBeGreaterThan(0)
  })
})

describe('calculateKDRatio', () => {
  test('returns kills when deaths is 0', () => {
    expect(calculateKDRatio(10, 0)).toBe(10)
  })

  test('calculates ratio correctly', () => {
    expect(calculateKDRatio(10, 5)).toBe(2)
    expect(calculateKDRatio(7, 3)).toBe(2.33)
  })

  test('handles equal kills and deaths', () => {
    expect(calculateKDRatio(5, 5)).toBe(1)
  })

  test('returns 0 for no kills', () => {
    expect(calculateKDRatio(0, 5)).toBe(0)
  })
})

describe('formatXP', () => {
  test('formats number with locale separators', () => {
    expect(formatXP(1000)).toMatch(/1[,.]?000/)
    expect(formatXP(1000000)).toMatch(/1[,.]?000[,.]?000/)
  })

  test('handles bigint', () => {
    expect(formatXP(1000n)).toMatch(/1[,.]?000/)
  })
})

describe('sortByRarity', () => {
  test('sorts items by rarity descending', () => {
    const items: GameItem[] = [
      createMockItem({ id: '1', rarity: 0 }),
      createMockItem({ id: '2', rarity: 4 }),
      createMockItem({ id: '3', rarity: 2 }),
    ]
    const sorted = sortByRarity(items)
    expect(sorted[0].rarity).toBe(4)
    expect(sorted[1].rarity).toBe(2)
    expect(sorted[2].rarity).toBe(0)
  })

  test('does not mutate original array', () => {
    const items: GameItem[] = [
      createMockItem({ id: '1', rarity: 0 }),
      createMockItem({ id: '2', rarity: 4 }),
    ]
    const sorted = sortByRarity(items)
    expect(items[0].rarity).toBe(0)
    expect(sorted[0].rarity).toBe(4)
  })
})

describe('sortByBalance', () => {
  test('sorts items by balance descending', () => {
    const items: GameItem[] = [
      createMockItem({ id: '1', balance: '10' }),
      createMockItem({ id: '2', balance: '100' }),
      createMockItem({ id: '3', balance: '50' }),
    ]
    const sorted = sortByBalance(items)
    expect(sorted[0].balance).toBe('100')
    expect(sorted[1].balance).toBe('50')
    expect(sorted[2].balance).toBe('10')
  })

  test('handles large numbers', () => {
    const items: GameItem[] = [
      createMockItem({ id: '1', balance: '1000000000000000000' }),
      createMockItem({ id: '2', balance: '9999999999999999999' }),
    ]
    const sorted = sortByBalance(items)
    expect(sorted[0].balance).toBe('9999999999999999999')
  })
})
