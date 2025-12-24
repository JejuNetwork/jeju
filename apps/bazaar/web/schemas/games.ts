/**
 * Game-related Zod schemas
 * Validation for game data from indexer and contracts
 */

import {
  AddressSchema,
  BigIntSchema,
  NonEmptyStringSchema,
} from '@jejunetwork/types'
import { z } from 'zod'

// Rarity enum (matches Items.sol)
export const RaritySchema = z.union([
  z.literal(0), // Common
  z.literal(1), // Uncommon
  z.literal(2), // Rare
  z.literal(3), // Epic
  z.literal(4), // Legendary
])
export type Rarity = z.infer<typeof RaritySchema>

// Game Item Category enum for filtering
export const ItemCategorySchema = z.enum([
  'all',
  'weapons',
  'armor',
  'tools',
  'resources',
])
export type ItemCategory = z.infer<typeof ItemCategorySchema>

// Registered Game from ERC-8004 registry
export const RegisteredGameSchema = z.object({
  id: NonEmptyStringSchema,
  agentId: z.number().int().nonnegative(),
  name: NonEmptyStringSchema,
  tags: z.array(z.string()),
  totalPlayers: z.number().int().nonnegative().optional(),
  totalItems: z.number().int().nonnegative().optional(),
})
export type RegisteredGame = z.infer<typeof RegisteredGameSchema>

// Game Item from Items.sol (ERC-1155)
export const GameItemSchema = z.object({
  id: NonEmptyStringSchema,
  tokenId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  rarity: z.number().int().min(0).max(4),
  attack: z.number().int().nonnegative(),
  defense: z.number().int().nonnegative(),
  strength: z.number().int().nonnegative(),
  stackable: z.boolean(),
  balance: NonEmptyStringSchema,
  owner: NonEmptyStringSchema,
  originalMinter: NonEmptyStringSchema.optional(),
  mintedAt: z.number().int().nonnegative().optional(),
})
export type GameItem = z.infer<typeof GameItemSchema>

// Game Feed Post from GameFeedOracle
export const GameFeedPostSchema = z.object({
  id: NonEmptyStringSchema,
  sessionId: NonEmptyStringSchema,
  postId: NonEmptyStringSchema,
  author: AddressSchema,
  content: z.string(),
  gameDay: z.number().int().nonnegative(),
  timestamp: z.string(),
  isSystemMessage: z.boolean(),
  blockNumber: BigIntSchema,
  transactionHash: NonEmptyStringSchema,
})
export type GameFeedPost = z.infer<typeof GameFeedPostSchema>

// Game Market Update from oracle
export const GameMarketUpdateSchema = z.object({
  id: NonEmptyStringSchema,
  sessionId: NonEmptyStringSchema,
  yesOdds: z.number().min(0).max(100),
  noOdds: z.number().min(0).max(100),
  totalVolume: BigIntSchema,
  gameDay: z.number().int().nonnegative(),
  timestamp: z.string(),
  blockNumber: BigIntSchema,
  transactionHash: NonEmptyStringSchema,
})
export type GameMarketUpdate = z.infer<typeof GameMarketUpdateSchema>

// Player Skill Event
export const PlayerSkillEventSchema = z.object({
  id: NonEmptyStringSchema,
  player: AddressSchema,
  skillName: NonEmptyStringSchema,
  newLevel: z.number().int().positive(),
  totalXp: BigIntSchema,
  timestamp: z.string(),
  blockNumber: BigIntSchema,
  transactionHash: NonEmptyStringSchema,
})
export type PlayerSkillEvent = z.infer<typeof PlayerSkillEventSchema>

// Player Death Event
export const PlayerDeathEventSchema = z.object({
  id: NonEmptyStringSchema,
  player: AddressSchema,
  killer: AddressSchema.nullable(),
  location: z.string(),
  timestamp: z.string(),
  blockNumber: BigIntSchema,
  transactionHash: NonEmptyStringSchema,
})
export type PlayerDeathEvent = z.infer<typeof PlayerDeathEventSchema>

// Player Kill Event
export const PlayerKillEventSchema = z.object({
  id: NonEmptyStringSchema,
  killer: AddressSchema,
  victim: AddressSchema,
  method: z.string(),
  timestamp: z.string(),
  blockNumber: BigIntSchema,
  transactionHash: NonEmptyStringSchema,
})
export type PlayerKillEvent = z.infer<typeof PlayerKillEventSchema>

// Player Achievement Event
export const PlayerAchievementEventSchema = z.object({
  id: NonEmptyStringSchema,
  player: AddressSchema,
  achievementId: NonEmptyStringSchema,
  achievementType: NonEmptyStringSchema,
  value: BigIntSchema,
  timestamp: z.string(),
  blockNumber: BigIntSchema,
  transactionHash: NonEmptyStringSchema,
})
export type PlayerAchievementEvent = z.infer<
  typeof PlayerAchievementEventSchema
>

// Aggregated Player Stats
export const PlayerStatsSchema = z.object({
  id: NonEmptyStringSchema,
  player: AddressSchema,
  totalSkillEvents: z.number().int().nonnegative(),
  totalDeaths: z.number().int().nonnegative(),
  totalKills: z.number().int().nonnegative(),
  totalAchievements: z.number().int().nonnegative(),
  highestSkillLevel: z.number().int().nonnegative(),
  highestSkillName: z.string().nullable(),
  lastActive: z.string(),
})
export type PlayerStats = z.infer<typeof PlayerStatsSchema>

// Response schemas for indexer queries
export const RegisteredGamesResponseSchema = z.object({
  registeredGames: z.array(RegisteredGameSchema),
})

export const GameFeedResponseSchema = z.object({
  gameFeedPosts: z.array(GameFeedPostSchema),
  gameMarketUpdates: z.array(GameMarketUpdateSchema),
})

export const PlayerEventsResponseSchema = z.object({
  playerSkillEvents: z.array(PlayerSkillEventSchema),
  playerDeathEvents: z.array(PlayerDeathEventSchema),
  playerKillEvents: z.array(PlayerKillEventSchema),
  playerAchievements: z.array(PlayerAchievementEventSchema),
  playerStats: z.array(PlayerStatsSchema),
})
