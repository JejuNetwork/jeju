/**
 * Market Processor - Indexes JejuMarket and PredictionOracle events
 */

import { ethers } from 'ethers';
import { Store } from '@subsquid/typeorm-store';
import { ProcessorContext } from './processor';
import { Account, PredictionMarket, MarketTrade, MarketPosition, OracleGame } from './model';
import { createAccountFactory } from './lib/entities';

const marketInterface = new ethers.Interface([
    'event MarketCreated(bytes32 indexed sessionId, string question, uint256 liquidity)',
    'event SharesPurchased(bytes32 indexed sessionId, address indexed trader, bool outcome, uint256 shares, uint256 cost)',
    'event SharesSold(bytes32 indexed sessionId, address indexed trader, bool outcome, uint256 shares, uint256 payout)',
    'event MarketResolved(bytes32 indexed sessionId, bool outcome)',
    'event PayoutClaimed(bytes32 indexed sessionId, address indexed trader, uint256 amount)',
    'event GameCommitted(bytes32 indexed sessionId, string question, bytes32 commitment, uint256 startTime)',
    'event GameRevealed(bytes32 indexed sessionId, bool outcome, uint256 endTime, bytes teeQuote, uint256 winnersCount)'
]);

const MARKET_CREATED = ethers.id('MarketCreated(bytes32,string,uint256)');
const SHARES_PURCHASED = ethers.id('SharesPurchased(bytes32,address,bool,uint256,uint256)');
const SHARES_SOLD = ethers.id('SharesSold(bytes32,address,bool,uint256,uint256)');
const MARKET_RESOLVED = ethers.id('MarketResolved(bytes32,bool)');
const PAYOUT_CLAIMED = ethers.id('PayoutClaimed(bytes32,address,uint256)');
const GAME_COMMITTED = ethers.id('GameCommitted(bytes32,string,bytes32,uint256)');
const GAME_REVEALED = ethers.id('GameRevealed(bytes32,bool,uint256,bytes,uint256)');

export async function processMarketEvents(ctx: ProcessorContext<Store>): Promise<void> {
    const markets = new Map<string, PredictionMarket>();
    const trades: MarketTrade[] = [];
    const positions = new Map<string, MarketPosition>();
    const oracleGames = new Map<string, OracleGame>();
    const accountFactory = createAccountFactory();

    function getOrCreatePosition(marketId: string, traderId: string, market: PredictionMarket, trader: Account, timestamp: Date): MarketPosition {
        const id = `${marketId}-${traderId}`;
        let position = positions.get(id);
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
                lastUpdated: timestamp
            });
            positions.set(id, position);
        }
        return position;
    }

    for (const block of ctx.blocks) {
        const blockTimestamp = new Date(block.header.timestamp);
        
        for (const log of block.logs) {
            const eventSig = log.topics[0];
            if (!log.transaction) continue;
            const txHash = log.transaction.hash;
            
            if (eventSig === MARKET_CREATED) {
                const sessionId = log.topics[1];
                const decoded = marketInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                markets.set(sessionId, new PredictionMarket({
                    id: sessionId,
                    sessionId,
                    question: decoded.args.question,
                    liquidityB: BigInt(decoded.args.liquidity.toString()),
                    yesShares: 0n,
                    noShares: 0n,
                    totalVolume: 0n,
                    createdAt: blockTimestamp,
                    resolved: false
                }));
            }
            else if (eventSig === SHARES_PURCHASED) {
                const sessionId = log.topics[1];
                const buyer = '0x' + log.topics[2].slice(26);
                const market = markets.get(sessionId);
                if (!market) continue;
                
                const decoded = marketInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                const shares = BigInt(decoded.args.shares.toString());
                const cost = BigInt(decoded.args.cost.toString());
                const totalShares = market.yesShares + market.noShares;
                const yesPercent = totalShares > 0n ? (market.yesShares * 10000n) / totalShares : 5000n;
                const trader = accountFactory.getOrCreate(buyer, block.header.height, blockTimestamp);
                
                trades.push(new MarketTrade({
                    id: `${txHash}-${log.logIndex}`,
                    market,
                    trader,
                    outcome: decoded.args.outcome,
                    isBuy: true,
                    shares,
                    cost,
                    priceAfter: yesPercent,
                    timestamp: blockTimestamp
                }));
                
                const position = getOrCreatePosition(sessionId, buyer, market, trader, blockTimestamp);
                if (decoded.args.outcome) {
                    position.yesShares = position.yesShares + shares;
                } else {
                    position.noShares = position.noShares + shares;
                }
                position.totalSpent = position.totalSpent + cost;
                position.lastUpdated = blockTimestamp;
                market.totalVolume = market.totalVolume + cost;
            }
            else if (eventSig === SHARES_SOLD) {
                const sessionId = log.topics[1];
                const seller = '0x' + log.topics[2].slice(26);
                const market = markets.get(sessionId);
                if (!market) continue;
                
                const decoded = marketInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                const shares = BigInt(decoded.args.shares.toString());
                const payout = BigInt(decoded.args.payout.toString());
                const totalShares = market.yesShares + market.noShares;
                const yesPercent = totalShares > 0n ? (market.yesShares * 10000n) / totalShares : 5000n;
                const trader = accountFactory.getOrCreate(seller, block.header.height, blockTimestamp);
                
                trades.push(new MarketTrade({
                    id: `${txHash}-${log.logIndex}`,
                    market,
                    trader,
                    outcome: decoded.args.outcome,
                    isBuy: false,
                    shares,
                    cost: payout,
                    priceAfter: yesPercent,
                    timestamp: blockTimestamp
                }));
                
                const position = getOrCreatePosition(sessionId, seller, market, trader, blockTimestamp);
                if (decoded.args.outcome) {
                    position.yesShares = position.yesShares - shares;
                } else {
                    position.noShares = position.noShares - shares;
                }
                position.totalReceived = position.totalReceived + payout;
                position.lastUpdated = blockTimestamp;
                market.totalVolume = market.totalVolume + payout;
            }
            else if (eventSig === MARKET_RESOLVED) {
                const sessionId = log.topics[1];
                const market = markets.get(sessionId);
                if (!market) continue;
                
                const decoded = marketInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                market.resolved = true;
                market.outcome = decoded.args.outcome;
            }
            else if (eventSig === PAYOUT_CLAIMED) {
                const sessionId = log.topics[1];
                const trader = '0x' + log.topics[2].slice(26);
                const position = positions.get(`${sessionId}-${trader}`);
                if (!position) continue;
                
                const decoded = marketInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                position.hasClaimed = true;
                position.totalReceived = position.totalReceived + BigInt(decoded.args.amount.toString());
                position.lastUpdated = blockTimestamp;
            }
            else if (eventSig === GAME_COMMITTED) {
                const sessionId = log.topics[1];
                const decoded = marketInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                oracleGames.set(sessionId, new OracleGame({
                    id: sessionId,
                    sessionId,
                    question: decoded.args.question,
                    commitment: decoded.args.commitment,
                    committedAt: blockTimestamp,
                    finalized: false,
                    winners: [],
                    totalPayout: 0n
                }));
            }
            else if (eventSig === GAME_REVEALED) {
                const sessionId = log.topics[1];
                const game = oracleGames.get(sessionId);
                if (!game) continue;
                
                const decoded = marketInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                game.finalized = true;
                game.revealedAt = blockTimestamp;
                game.outcome = decoded.args.outcome;
                
                const market = markets.get(sessionId);
                if (market) {
                    market.resolved = true;
                    market.outcome = decoded.args.outcome;
                }
            }
        }
    }

    await ctx.store.upsert(accountFactory.getAll());
    await ctx.store.upsert([...markets.values()]);
    await ctx.store.insert(trades);
    await ctx.store.upsert([...positions.values()]);
    await ctx.store.upsert([...oracleGames.values()]);
}
