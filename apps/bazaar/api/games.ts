/**
 * Game business logic and utilities
 * Extracted from pages/hooks for testability
 */

import { expect } from '@jejunetwork/types'
import { z } from 'zod'
import { INDEXER_URL } from '../config'
import {
  type GameItem,
  type ItemCategory,
  type RegisteredGame,
  RegisteredGamesResponseSchema,
} from '../schemas/games'

// GraphQL response schema for games query
const GamesGraphQLResponseSchema = z.object({
  data: RegisteredGamesResponseSchema.optional(),
})

// GraphQL query for registered games
const REGISTERED_GAMES_QUERY = `
  query GetGames {
    registeredGames(where: { active_eq: true }, orderBy: registeredAt_DESC) {
      id
      agentId
      name
      tags
      totalPlayers
      totalItems
    }
  }
`

/**
 * Fetch registered games from the indexer
 * Games are registered via ERC-8004 registry
 */
export async function fetchRegisteredGames(): Promise<RegisteredGame[]> {
  const endpoint = expect(INDEXER_URL, 'INDEXER_URL not configured')

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: REGISTERED_GAMES_QUERY }),
  })

  const rawJson: unknown = await response.json()
  const parsed = GamesGraphQLResponseSchema.safeParse(rawJson)

  if (!parsed.success || !parsed.data.data) {
    return []
  }

  return parsed.data.data.registeredGames
}

// Rarity info lookup table
const RARITY_INFO = [
  { name: 'Common', color: 'text-gray-400', bgClass: 'bg-gray-500/20' },
  { name: 'Uncommon', color: 'text-green-400', bgClass: 'bg-green-500/20' },
  { name: 'Rare', color: 'text-blue-400', bgClass: 'bg-blue-500/20' },
  { name: 'Epic', color: 'text-purple-400', bgClass: 'bg-purple-500/20' },
  { name: 'Legendary', color: 'text-yellow-400', bgClass: 'bg-yellow-500/20' },
] as const

const UNKNOWN_RARITY = {
  name: 'Unknown',
  color: 'text-gray-400',
  bgClass: 'bg-gray-500/20',
} as const

export interface RarityInfo {
  name: string
  color: string
  bgClass: string
}

/**
 * Get display info for item rarity
 * @param rarity - Rarity value (0-4 matching Items.sol enum)
 */
export function getRarityInfo(rarity: number): RarityInfo {
  return RARITY_INFO[rarity] ?? UNKNOWN_RARITY
}

/**
 * Get rarity name from value
 */
export function getRarityName(rarity: number): string {
  return getRarityInfo(rarity).name
}

/**
 * Check if rarity is valid (0-4)
 */
export function isValidRarity(rarity: number): boolean {
  return rarity >= 0 && rarity <= 4
}

// Item category detection keywords
const CATEGORY_KEYWORDS: Record<ItemCategory, string[]> = {
  all: [],
  weapons: ['sword', 'bow', 'staff', 'axe', 'dagger', 'spear', 'mace'],
  armor: ['helmet', 'body', 'legs', 'shield', 'gloves', 'boots', 'chest'],
  tools: ['hatchet', 'pickaxe', 'fishing', 'hammer', 'shovel'],
  resources: ['logs', 'ore', 'fish', 'herb', 'gem', 'stone', 'wood'],
}

/**
 * Determine item category from name and stats
 * Used for filtering items in the UI
 * Priority: tools keywords > stats > other keywords > default
 */
export function getItemCategory(item: GameItem): ItemCategory {
  const name = item.name.toLowerCase()

  // Check tools keywords first (pickaxe, hatchet, fishing rod are tools, not weapons)
  if (CATEGORY_KEYWORDS.tools.some((keyword) => name.includes(keyword))) {
    return 'tools'
  }

  // Check by stats
  if (item.attack > 0 && item.defense === 0) return 'weapons'
  if (item.defense > 0 && item.attack === 0) return 'armor'
  if (item.stackable && item.attack === 0 && item.defense === 0)
    return 'resources'

  // Check by name keywords for remaining categories
  const categoryEntries: [ItemCategory, string[]][] = [
    ['weapons', CATEGORY_KEYWORDS.weapons],
    ['armor', CATEGORY_KEYWORDS.armor],
    ['resources', CATEGORY_KEYWORDS.resources],
  ]
  for (const [category, keywords] of categoryEntries) {
    if (keywords.some((keyword) => name.includes(keyword))) {
      return category
    }
  }

  return 'all'
}

/**
 * Filter items by category
 */
export function filterItemsByCategory(
  items: GameItem[],
  category: ItemCategory,
): GameItem[] {
  if (category === 'all') return items

  return items.filter((item) => {
    const name = item.name.toLowerCase()
    const keywords = CATEGORY_KEYWORDS[category]

    // Check keywords
    if (keywords.some((keyword) => name.includes(keyword))) return true

    // Check stats
    switch (category) {
      case 'weapons':
        return item.attack > 0
      case 'armor':
        return item.defense > 0
      case 'resources':
        return item.stackable && item.attack === 0 && item.defense === 0
      case 'tools':
        return keywords.some((keyword) => name.includes(keyword))
      default:
        return false
    }
  })
}

/**
 * Format item stats for display
 */
export function formatItemStats(item: GameItem): string[] {
  const stats: string[] = []
  if (item.attack > 0) stats.push(`⚔️ Attack: +${item.attack}`)
  if (item.strength > 0) stats.push(`💪 Strength: +${item.strength}`)
  if (item.defense > 0) stats.push(`🛡️ Defense: +${item.defense}`)
  return stats
}

/**
 * Check if item has combat stats
 */
export function hasCombatStats(item: GameItem): boolean {
  return item.attack > 0 || item.defense > 0 || item.strength > 0
}

export { formatAddress } from '@jejunetwork/shared'

/**
 * Format timestamp for display
 */
export function formatGameTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString()
}

/**
 * Calculate kill/death ratio
 */
export function calculateKDRatio(kills: number, deaths: number): number {
  if (deaths === 0) return kills
  return Number((kills / deaths).toFixed(2))
}

/**
 * Format XP amount for display
 */
export function formatXP(xp: bigint | number): string {
  return Number(xp).toLocaleString()
}

/**
 * Sort items by rarity (legendary first)
 */
export function sortByRarity(items: GameItem[]): GameItem[] {
  return [...items].sort((a, b) => b.rarity - a.rarity)
}

/**
 * Sort items by balance (highest first)
 */
export function sortByBalance(items: GameItem[]): GameItem[] {
  return [...items].sort((a, b) =>
    BigInt(b.balance) > BigInt(a.balance) ? 1 : -1,
  )
}
