/**
 * Market Processor - Indexes NetworkMarket and PredictionOracle events
 */

import type { Store } from '@subsquid/typeorm-store'
import { keccak256, parseAbi, stringToHex } from 'viem'
import {
  type Account,
  MarketPosition,
  MarketTrade,
  OracleGame,
  PredictionMarket,
} from '../src/model'
import type { ProcessorContext } from './processor'
import { createAccountFactory } from './utils/entities'
import { decodeEventArgs } from './utils/hex'

const marketInterface = parseAbi([
  'event MarketCreated(bytes32 indexed sessionId, string question, uint256 liquidity)',
  'event SharesPurchased(bytes32 indexed sessionId, address indexed trader, bool outcome, uint256 shares, uint256 cost)',
  'event SharesSold(bytes32 indexed sessionId, address indexed trader, bool outcome, uint256 shares, uint256 payout)',
  'event MarketResolved(bytes32 indexed sessionId, bool outcome)',
  'event PayoutClaimed(bytes32 indexed sessionId, address indexed trader, uint256 amount)',
  'event GameCommitted(bytes32 indexed sessionId, string question, bytes32 commitment, uint256 startTime)',
  'event GameRevealed(bytes32 indexed sessionId, bool outcome, uint256 endTime, bytes teeQuote, uint256 winnersCount)',
])

const MARKET_CREATED = keccak256(
  stringToHex('MarketCreated(bytes32,string,uint256)'),
)
const SHARES_PURCHASED = keccak256(
  stringToHex('SharesPurchased(bytes32,address,bool,uint256,uint256)'),
)
const SHARES_SOLD = keccak256(
  stringToHex('SharesSold(bytes32,address,bool,uint256,uint256)'),
)
const MARKET_RESOLVED = keccak256(stringToHex('MarketResolved(bytes32,bool)'))
const PAYOUT_CLAIMED = keccak256(
  stringToHex('PayoutClaimed(bytes32,address,uint256)'),
)
const GAME_COMMITTED = keccak256(
  stringToHex('GameCommitted(bytes32,string,bytes32,uint256)'),
)
const GAME_REVEALED = keccak256(
  stringToHex('GameRevealed(bytes32,bool,uint256,bytes,uint256)'),
)

// Event argument interfaces
interface MarketCreatedArgs {
  sessionId: string
  question: string
  liquidity: bigint
}

interface SharesPurchasedArgs {
  sessionId: string
  trader: string
  outcome: boolean
  shares: bigint
  cost: bigint
}

interface SharesSoldArgs {
  sessionId: string
  trader: string
  outcome: boolean
  shares: bigint
  payout: bigint
}

interface MarketResolvedArgs {
  sessionId: string
  outcome: boolean
}

interface PayoutClaimedArgs {
  sessionId: string
  trader: string
  amount: bigint
}

interface GameCommittedArgs {
  sessionId: string
  question: string
  commitment: string
  startTime: bigint
}

interface GameRevealedArgs {
  sessionId: string
  outcome: boolean
  endTime: bigint
  teeQuote: string
  winnersCount: bigint
}

export async function processMarketEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const markets = new Map<string, PredictionMarket>()
  const trades: MarketTrade[] = []
  const positions = new Map<string, MarketPosition>()
  const oracleGames = new Map<string, OracleGame>()
  const accountFactory = createAccountFactory()

  function getOrCreatePosition(
    marketId: string,
    traderId: string,
    market: PredictionMarket,
    trader: Account,
    timestamp: Date,
  ): MarketPosition {
    const id = `${marketId}-${traderId}`
    let position = positions.get(id)
    if (!position) {
      position = new MarketPosition({
        id,
        market,
        trader,
        yesShares: 0n,
        noShares: 0n,
        totalSpent: 0n,
        totalReceived: 0n,
        hasClaimed: false,
        lastUpdated: timestamp,
      })
      positions.set(id, position)
    }
    return position
  }

  for (const block of ctx.blocks) {
    const blockTimestamp = new Date(block.header.timestamp)

    for (const log of block.logs) {
      const eventSig = log.topics[0]
      if (!log.transaction) continue
      const txHash = log.transaction.hash

      if (eventSig === MARKET_CREATED) {
        const sessionId = log.topics[1]
        const args = decodeEventArgs<MarketCreatedArgs>(
          marketInterface,
          log.data,
          log.topics,
        )

        markets.set(
          sessionId,
          new PredictionMarket({
            id: sessionId,
            sessionId,
            question: args.question,
            liquidityB: BigInt(args.liquidity.toString()),
            yesShares: 0n,
            noShares: 0n,
            totalVolume: 0n,
            createdAt: blockTimestamp,
            resolved: false,
          }),
        )
      } else if (eventSig === SHARES_PURCHASED) {
        const sessionId = log.topics[1]
        const buyer = `0x${log.topics[2].slice(26)}`
        const market = markets.get(sessionId)
        if (!market) continue

        const args = decodeEventArgs<SharesPurchasedArgs>(
          marketInterface,
          log.data,
          log.topics,
        )

        const shares = BigInt(args.shares.toString())
        const cost = BigInt(args.cost.toString())
        const totalShares = market.yesShares + market.noShares
        const yesPercent =
          totalShares > 0n ? (market.yesShares * 10000n) / totalShares : 5000n
        const trader = accountFactory.getOrCreate(
          buyer,
          block.header.height,
          blockTimestamp,
        )

        trades.push(
          new MarketTrade({
            id: `${txHash}-${log.logIndex}`,
            market,
            trader,
            outcome: args.outcome,
            isBuy: true,
            shares,
            cost,
            priceAfter: yesPercent,
            timestamp: blockTimestamp,
          }),
        )

        const position = getOrCreatePosition(
          sessionId,
          buyer,
          market,
          trader,
          blockTimestamp,
        )
        if (args.outcome) {
          position.yesShares = position.yesShares + shares
        } else {
          position.noShares = position.noShares + shares
        }
        position.totalSpent = position.totalSpent + cost
        position.lastUpdated = blockTimestamp
        market.totalVolume = market.totalVolume + cost
      } else if (eventSig === SHARES_SOLD) {
        const sessionId = log.topics[1]
        const seller = `0x${log.topics[2].slice(26)}`
        const market = markets.get(sessionId)
        if (!market) continue

        const args = decodeEventArgs<SharesSoldArgs>(
          marketInterface,
          log.data,
          log.topics,
        )

        const shares = BigInt(args.shares.toString())
        const payout = BigInt(args.payout.toString())
        const totalShares = market.yesShares + market.noShares
        const yesPercent =
          totalShares > 0n ? (market.yesShares * 10000n) / totalShares : 5000n
        const trader = accountFactory.getOrCreate(
          seller,
          block.header.height,
          blockTimestamp,
        )

        trades.push(
          new MarketTrade({
            id: `${txHash}-${log.logIndex}`,
            market,
            trader,
            outcome: args.outcome,
            isBuy: false,
            shares,
            cost: payout,
            priceAfter: yesPercent,
            timestamp: blockTimestamp,
          }),
        )

        const position = getOrCreatePosition(
          sessionId,
          seller,
          market,
          trader,
          blockTimestamp,
        )
        if (args.outcome) {
          position.yesShares = position.yesShares - shares
        } else {
          position.noShares = position.noShares - shares
        }
        position.totalReceived = position.totalReceived + payout
        position.lastUpdated = blockTimestamp
        market.totalVolume = market.totalVolume + payout
      } else if (eventSig === MARKET_RESOLVED) {
        const sessionId = log.topics[1]
        const market = markets.get(sessionId)
        if (!market) continue

        const args = decodeEventArgs<MarketResolvedArgs>(
          marketInterface,
          log.data,
          log.topics,
        )

        market.resolved = true
        market.outcome = args.outcome
      } else if (eventSig === PAYOUT_CLAIMED) {
        const sessionId = log.topics[1]
        const trader = `0x${log.topics[2].slice(26)}`
        const position = positions.get(`${sessionId}-${trader}`)
        if (!position) continue

        const args = decodeEventArgs<PayoutClaimedArgs>(
          marketInterface,
          log.data,
          log.topics,
        )

        position.hasClaimed = true
        position.totalReceived =
          position.totalReceived + BigInt(args.amount.toString())
        position.lastUpdated = blockTimestamp
      } else if (eventSig === GAME_COMMITTED) {
        const sessionId = log.topics[1]
        const args = decodeEventArgs<GameCommittedArgs>(
          marketInterface,
          log.data,
          log.topics,
        )

        oracleGames.set(
          sessionId,
          new OracleGame({
            id: sessionId,
            sessionId,
            question: args.question,
            commitment: args.commitment,
            committedAt: blockTimestamp,
            finalized: false,
            winners: [],
            totalPayout: 0n,
          }),
        )
      } else if (eventSig === GAME_REVEALED) {
        const sessionId = log.topics[1]
        const game = oracleGames.get(sessionId)
        if (!game) continue

        const args = decodeEventArgs<GameRevealedArgs>(
          marketInterface,
          log.data,
          log.topics,
        )

        game.finalized = true
        game.revealedAt = blockTimestamp
        game.outcome = args.outcome

        const market = markets.get(sessionId)
        if (market) {
          market.resolved = true
          market.outcome = args.outcome
        }
      }
    }
  }

  await ctx.store.upsert(accountFactory.getAll())
  await ctx.store.upsert([...markets.values()])
  await ctx.store.insert(trades)
  await ctx.store.upsert([...positions.values()])
  await ctx.store.upsert([...oracleGames.values()])
}
