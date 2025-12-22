/**
 * Game Feed Processor - Indexes GameFeedOracle events
 */

import type { Store } from '@subsquid/typeorm-store'
import { decodeEventLog, keccak256, parseAbi, stringToHex } from 'viem'
import {
  GameFeedPost,
  GameMarketUpdate,
  GamePhaseChange,
  PlayerAchievement,
  PlayerDeathEvent,
  PlayerKillEvent,
  PlayerSkillEvent,
  PlayerStats,
} from './model'
import type { ProcessorContext } from './processor'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const gameFeedInterface = parseAbi([
  'event FeedPostPublished(bytes32 indexed sessionId, bytes32 indexed postId, address indexed author, string content, uint8 gameDay, uint256 timestamp)',
  'event MarketUpdated(bytes32 indexed sessionId, uint8 yesOdds, uint8 noOdds, uint256 totalVolume, uint8 gameDay, uint256 timestamp)',
  'event GamePhaseChanged(bytes32 indexed sessionId, string phase, uint8 day, uint256 timestamp)',
  'event SkillLeveledUp(address indexed player, string skillName, uint8 newLevel, uint256 totalXp)',
  'event PlayerDied(address indexed player, address killer, string location, uint256 timestamp)',
  'event PlayerKilled(address indexed killer, address indexed victim, string method, uint256 timestamp)',
  'event AchievementUnlocked(address indexed player, string achievementId, string achievementType, uint256 value)',
])

const FEED_POST = keccak256(
  stringToHex(
    'FeedPostPublished(bytes32,bytes32,address,string,uint8,uint256)',
  ),
)
const MARKET_UPDATE = keccak256(
  stringToHex('MarketUpdated(bytes32,uint8,uint8,uint256,uint8,uint256)'),
)
const PHASE_CHANGE = keccak256(
  stringToHex('GamePhaseChanged(bytes32,string,uint8,uint256)'),
)
const SKILL_EVENT = keccak256(
  stringToHex('SkillLeveledUp(address,string,uint8,uint256)'),
)
const DEATH_EVENT = keccak256(
  stringToHex('PlayerDied(address,address,string,uint256)'),
)
const KILL_EVENT = keccak256(
  stringToHex('PlayerKilled(address,address,string,uint256)'),
)
const ACHIEVEMENT = keccak256(
  stringToHex('AchievementUnlocked(address,string,string,uint256)'),
)

function getOrCreatePlayerStats(
  playerStats: Map<string, PlayerStats>,
  player: string,
  timestamp: Date,
): PlayerStats {
  let stats = playerStats.get(player)
  if (!stats) {
    stats = new PlayerStats({
      id: player,
      player,
      totalSkillEvents: 0,
      totalDeaths: 0,
      totalKills: 0,
      totalAchievements: 0,
      highestSkillLevel: 0,
      lastActive: timestamp,
    })
    playerStats.set(player, stats)
  }
  return stats
}

export async function processGameFeedEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const feedPosts: GameFeedPost[] = []
  const marketUpdates: GameMarketUpdate[] = []
  const phaseChanges: GamePhaseChange[] = []
  const skillEvents: PlayerSkillEvent[] = []
  const deathEvents: PlayerDeathEvent[] = []
  const killEvents: PlayerKillEvent[] = []
  const achievements: PlayerAchievement[] = []
  const playerStats = new Map<string, PlayerStats>()

  for (const block of ctx.blocks) {
    const blockTimestamp = new Date(block.header.timestamp)

    for (const log of block.logs) {
      const eventSig = log.topics[0]
      if (!log.transaction) continue
      const txHash = log.transaction.hash

      if (eventSig === FEED_POST) {
        const { args } = decodeEventLog({
          abi: gameFeedInterface,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        }) as {
          args: {
            sessionId: string
            postId: string
            author: string
            content: string
            gameDay: number
            timestamp: bigint
          }
        }

        feedPosts.push(
          new GameFeedPost({
            id: `${txHash}-${log.logIndex}`,
            sessionId: args.sessionId,
            postId: args.postId,
            author: args.author,
            content: args.content,
            gameDay: args.gameDay,
            timestamp: new Date(Number(args.timestamp) * 1000),
            isSystemMessage: args.author === ZERO_ADDRESS,
            blockNumber: BigInt(block.header.height),
            transactionHash: txHash,
          }),
        )
      } else if (eventSig === MARKET_UPDATE) {
        const { args } = decodeEventLog({
          abi: gameFeedInterface,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        }) as {
          args: {
            sessionId: string
            yesOdds: number
            noOdds: number
            totalVolume: bigint
            gameDay: number
            timestamp: bigint
          }
        }

        marketUpdates.push(
          new GameMarketUpdate({
            id: `${txHash}-${log.logIndex}`,
            sessionId: args.sessionId,
            yesOdds: args.yesOdds,
            noOdds: args.noOdds,
            totalVolume: BigInt(args.totalVolume.toString()),
            gameDay: args.gameDay,
            timestamp: new Date(Number(args.timestamp) * 1000),
            blockNumber: BigInt(block.header.height),
            transactionHash: txHash,
          }),
        )
      } else if (eventSig === PHASE_CHANGE) {
        const { args } = decodeEventLog({
          abi: gameFeedInterface,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        }) as {
          args: {
            sessionId: string
            phase: string
            day: number
            timestamp: bigint
          }
        }

        phaseChanges.push(
          new GamePhaseChange({
            id: `${txHash}-${log.logIndex}`,
            sessionId: args.sessionId,
            phase: args.phase,
            day: args.day,
            timestamp: new Date(Number(args.timestamp) * 1000),
            blockNumber: BigInt(block.header.height),
            transactionHash: txHash,
          }),
        )
      } else if (eventSig === SKILL_EVENT) {
        const { args } = decodeEventLog({
          abi: gameFeedInterface,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        }) as {
          args: {
            player: string
            skillName: string
            newLevel: number
            totalXp: bigint
          }
        }

        const player = args.player.toLowerCase()

        skillEvents.push(
          new PlayerSkillEvent({
            id: `${txHash}-${log.logIndex}`,
            player,
            skillName: args.skillName,
            newLevel: args.newLevel,
            totalXp: BigInt(args.totalXp.toString()),
            timestamp: blockTimestamp,
            blockNumber: BigInt(block.header.height),
            transactionHash: txHash,
          }),
        )

        const stats = getOrCreatePlayerStats(
          playerStats,
          player,
          blockTimestamp,
        )
        stats.totalSkillEvents++
        if (args.newLevel > stats.highestSkillLevel) {
          stats.highestSkillLevel = args.newLevel
          stats.highestSkillName = args.skillName
        }
        stats.lastActive = blockTimestamp
      } else if (eventSig === DEATH_EVENT) {
        const { args } = decodeEventLog({
          abi: gameFeedInterface,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        }) as {
          args: {
            player: string
            killer: string
            location: string
            timestamp: bigint
          }
        }

        const player = args.player.toLowerCase()
        const killerAddr = args.killer

        deathEvents.push(
          new PlayerDeathEvent({
            id: `${txHash}-${log.logIndex}`,
            player,
            killer:
              killerAddr !== ZERO_ADDRESS ? killerAddr.toLowerCase() : null,
            location: args.location,
            timestamp: new Date(Number(args.timestamp) * 1000),
            blockNumber: BigInt(block.header.height),
            transactionHash: txHash,
          }),
        )

        const stats = getOrCreatePlayerStats(
          playerStats,
          player,
          blockTimestamp,
        )
        stats.totalDeaths++
        stats.lastActive = blockTimestamp
      } else if (eventSig === KILL_EVENT) {
        const { args } = decodeEventLog({
          abi: gameFeedInterface,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        }) as {
          args: {
            killer: string
            victim: string
            method: string
            timestamp: bigint
          }
        }

        const killer = args.killer.toLowerCase()

        killEvents.push(
          new PlayerKillEvent({
            id: `${txHash}-${log.logIndex}`,
            killer,
            victim: args.victim.toLowerCase(),
            method: args.method,
            timestamp: new Date(Number(args.timestamp) * 1000),
            blockNumber: BigInt(block.header.height),
            transactionHash: txHash,
          }),
        )

        const stats = getOrCreatePlayerStats(
          playerStats,
          killer,
          blockTimestamp,
        )
        stats.totalKills++
        stats.lastActive = blockTimestamp
      } else if (eventSig === ACHIEVEMENT) {
        const { args } = decodeEventLog({
          abi: gameFeedInterface,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        }) as {
          args: {
            player: string
            achievementId: string
            achievementType: string
            value: bigint
          }
        }

        const player = args.player.toLowerCase()

        achievements.push(
          new PlayerAchievement({
            id: `${txHash}-${log.logIndex}`,
            player,
            achievementId: args.achievementId,
            achievementType: args.achievementType,
            value: BigInt(args.value.toString()),
            timestamp: blockTimestamp,
            blockNumber: BigInt(block.header.height),
            transactionHash: txHash,
          }),
        )

        const stats = getOrCreatePlayerStats(
          playerStats,
          player,
          blockTimestamp,
        )
        stats.totalAchievements++
        stats.lastActive = blockTimestamp
      }
    }
  }

  await ctx.store.insert(feedPosts)
  await ctx.store.insert(marketUpdates)
  await ctx.store.insert(phaseChanges)
  await ctx.store.insert(skillEvents)
  await ctx.store.insert(deathEvents)
  await ctx.store.insert(killEvents)
  await ctx.store.insert(achievements)
  await ctx.store.upsert([...playerStats.values()])
}
