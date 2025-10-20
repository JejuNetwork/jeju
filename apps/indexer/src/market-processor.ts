/**
 * Market Event Processor
 * Indexes JejuMarket and PredictionOracle events for the trading platform
 */

import { TypeormDatabase } from '@subsquid/typeorm-store';
import { EvmBatchProcessor } from '@subsquid/evm-processor';
import { ethers } from 'ethers';
import { 
    Account, Transaction, Block,
    PredictionMarket, MarketTrade, MarketPosition, OracleGame, MarketStats
} from './model';

// Event ABIs for decoding (matches JejuMarket.sol)
const MARKET_CREATED_ABI = 'event MarketCreated(bytes32 indexed sessionId, string question, uint256 liquidity)';
const SHARES_PURCHASED_ABI = 'event SharesPurchased(bytes32 indexed sessionId, address indexed trader, bool outcome, uint256 shares, uint256 cost)';
const SHARES_SOLD_ABI = 'event SharesSold(bytes32 indexed sessionId, address indexed trader, bool outcome, uint256 shares, uint256 payout)';
const MARKET_RESOLVED_ABI = 'event MarketResolved(bytes32 indexed sessionId, bool outcome)';
const PAYOUT_CLAIMED_ABI = 'event PayoutClaimed(bytes32 indexed sessionId, address indexed trader, uint256 amount)';
const GAME_COMMITTED_ABI = 'event GameCommitted(bytes32 indexed sessionId, string question, bytes32 commitment, uint256 startTime)';
const GAME_REVEALED_ABI = 'event GameRevealed(bytes32 indexed sessionId, bool outcome, uint256 endTime, bytes teeQuote, uint256 winnersCount)';

// Create interface for decoding
const marketInterface = new ethers.Interface([
    MARKET_CREATED_ABI,
    SHARES_PURCHASED_ABI,
    SHARES_SOLD_ABI,
    MARKET_RESOLVED_ABI,
    PAYOUT_CLAIMED_ABI,
    GAME_COMMITTED_ABI,
    GAME_REVEALED_ABI
]);

// Calculate event signatures using ethers.id()
const MARKET_CREATED = ethers.id('MarketCreated(bytes32,string,uint256)');
const SHARES_PURCHASED = ethers.id('SharesPurchased(bytes32,address,bool,uint256,uint256)');
const SHARES_SOLD = ethers.id('SharesSold(bytes32,address,bool,uint256,uint256)');
const MARKET_RESOLVED = ethers.id('MarketResolved(bytes32,bool)');
const PAYOUT_CLAIMED = ethers.id('PayoutClaimed(bytes32,address,uint256)');
const GAME_COMMITTED = ethers.id('GameCommitted(bytes32,string,bytes32,uint256)');
const GAME_REVEALED = ethers.id('GameRevealed(bytes32,bool,uint256,bytes,uint256)');

export const marketProcessor = new EvmBatchProcessor()
    .setRpcEndpoint(process.env.RPC_ETH_HTTP!)
    .setFinalityConfirmation(10)
    .setBlockRange({ from: parseInt(process.env.START_BLOCK || '0') })
    .addLog({
        topic0: [
            MARKET_CREATED,
            SHARES_PURCHASED,
            SHARES_SOLD,
            MARKET_RESOLVED,
            PAYOUT_CLAIMED,
            GAME_COMMITTED,
            GAME_REVEALED
        ]
    })
    .setFields({
        block: {
            timestamp: true
        },
        transaction: {
            hash: true,
            from: true,
            to: true
        },
        log: {
            address: true,
            data: true,
            topics: true,
            transactionHash: true
        }
    });

/**
 * Process market events
 * Models now generated - processor enabled!
 */
export async function processMarketEvents(ctx: any) {
    const markets = new Map<string, PredictionMarket>();
    const trades: MarketTrade[] = [];
    const positions = new Map<string, MarketPosition>();
    const oracleGames = new Map<string, OracleGame>();
    const accounts = new Map<string, Account>();

    function getOrCreateAccount(address: string, blockNumber: number): Account {
        const id = address.toLowerCase();
        let account = accounts.get(id);
        if (!account) {
            account = new Account({
                id,
                address: id,
                isContract: false,
                firstSeenBlock: blockNumber,
                lastSeenBlock: blockNumber,
                transactionCount: 0,
                totalValueSent: 0n,
                totalValueReceived: 0n,
                labels: []
            });
            accounts.set(id, account);
        }
        return account;
    }

    function getOrCreatePosition(marketId: string, traderId: string): MarketPosition {
        const id = `${marketId}-${traderId}`;
        let position = positions.get(id);
        if (!position) {
            const market = markets.get(marketId)!;
            const trader = accounts.get(traderId)!;
            
            position = new MarketPosition({
                id,
                market,
                trader,
                yesShares: 0n,
                noShares: 0n,
                totalSpent: 0n,
                totalReceived: 0n,
                hasClaimed: false,
                lastUpdated: new Date()
            });
            positions.set(id, position);
        }
        return position;
    }

    for (let block of ctx.blocks) {
        for (let log of block.logs) {
            const eventSig = log.topics[0];
            
            // Market Created
            if (eventSig === MARKET_CREATED) {
                const sessionId = log.topics[1];
                
                // Decode event data
                const decoded = marketInterface.parseLog({
                    topics: log.topics,
                    data: log.data
                });
                
                if (!decoded) continue;
                
                const market = new PredictionMarket({
                    id: sessionId,
                    sessionId,
                    question: decoded.args.question,
                    liquidityB: BigInt(decoded.args.liquidity.toString()),
                    yesShares: 0n,
                    noShares: 0n,
                    totalVolume: 0n,
                    createdAt: new Date(block.header.timestamp),
                    resolved: false
                });
                markets.set(sessionId, market);
            }
            
            // Shares Purchased
            else if (eventSig === SHARES_PURCHASED) {
                const sessionId = log.topics[1];
                const buyer = '0x' + log.topics[2].slice(26);
                
                const market = markets.get(sessionId);
                if (market) {
                    // Decode event data
                    const decoded = marketInterface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });
                    
                    if (!decoded) continue;
                    
                    const shares = BigInt(decoded.args.shares.toString());
                    const cost = BigInt(decoded.args.cost.toString());
                    
                    // Get current prices after trade
                    const totalShares = market.yesShares + market.noShares;
                    const yesPercent = totalShares > 0n ? (market.yesShares * 10000n) / totalShares : 5000n;
                    
                    // Create trade record
                    const trade = new MarketTrade({
                        id: `${log.transactionHash}-${log.logIndex}`,
                        market,
                        trader: getOrCreateAccount(buyer, block.header.height),
                        outcome: decoded.args.outcome,
                        isBuy: true,
                        shares,
                        cost,
                        priceAfter: yesPercent,
                        timestamp: new Date(block.header.timestamp)
                    });
                    trades.push(trade);
                    
                    // Update position
                    const position = getOrCreatePosition(sessionId, buyer);
                    if (decoded.args.outcome) {
                        position.yesShares = position.yesShares + shares;
                    } else {
                        position.noShares = position.noShares + shares;
                    }
                    position.totalSpent = position.totalSpent + cost;
                    position.lastUpdated = new Date(block.header.timestamp);
                    
                    // Update market stats
                    market.totalVolume = market.totalVolume + cost;
                }
            }
            
            // Shares Sold
            else if (eventSig === SHARES_SOLD) {
                const sessionId = log.topics[1];
                const seller = '0x' + log.topics[2].slice(26);
                
                const market = markets.get(sessionId);
                if (market) {
                    // Decode event data
                    const decoded = marketInterface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });
                    
                    if (!decoded) continue;
                    
                    const shares = BigInt(decoded.args.shares.toString());
                    const payout = BigInt(decoded.args.payout.toString());
                    
                    // Get current prices after trade
                    const totalShares = market.yesShares + market.noShares;
                    const yesPercent = totalShares > 0n ? (market.yesShares * 10000n) / totalShares : 5000n;
                    
                    // Create trade record
                    const trade = new MarketTrade({
                        id: `${log.transactionHash}-${log.logIndex}`,
                        market,
                        trader: getOrCreateAccount(seller, block.header.height),
                        outcome: decoded.args.outcome,
                        isBuy: false,
                        shares,
                        cost: payout,
                        priceAfter: yesPercent,
                        timestamp: new Date(block.header.timestamp)
                    });
                    trades.push(trade);
                    
                    // Update position
                    const position = getOrCreatePosition(sessionId, seller);
                    if (decoded.args.outcome) {
                        position.yesShares = position.yesShares - shares;
                    } else {
                        position.noShares = position.noShares - shares;
                    }
                    position.totalReceived = position.totalReceived + payout;
                    position.lastUpdated = new Date(block.header.timestamp);
                    
                    // Update market stats
                    market.totalVolume = market.totalVolume + payout;
                }
            }
            
            // Market Resolved
            else if (eventSig === MARKET_RESOLVED) {
                const sessionId = log.topics[1];
                
                const market = markets.get(sessionId);
                if (market) {
                    // Decode event data
                    const decoded = marketInterface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });
                    
                    if (!decoded) continue;
                    
                    market.resolved = true;
                    market.outcome = decoded.args.outcome;
                }
            }
            
            // Payout Claimed
            else if (eventSig === PAYOUT_CLAIMED) {
                const sessionId = log.topics[1];
                const trader = '0x' + log.topics[2].slice(26);
                
                const position = positions.get(`${sessionId}-${trader}`);
                if (position) {
                    // Decode event data
                    const decoded = marketInterface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });
                    
                    if (!decoded) continue;
                    
                    position.hasClaimed = true;
                    position.totalReceived = position.totalReceived + BigInt(decoded.args.amount.toString());
                    position.lastUpdated = new Date(block.header.timestamp);
                }
            }
            
            // Game Committed (Oracle)
            else if (eventSig === GAME_COMMITTED) {
                const sessionId = log.topics[1];
                
                // Decode event data
                const decoded = marketInterface.parseLog({
                    topics: log.topics,
                    data: log.data
                });
                
                if (!decoded) continue;
                
                const game = new OracleGame({
                    id: sessionId,
                    sessionId,
                    question: decoded.args.question,
                    commitment: decoded.args.commitment,
                    committedAt: new Date(block.header.timestamp),
                    finalized: false,
                    winners: [],
                    totalPayout: 0n
                });
                oracleGames.set(sessionId, game);
            }
            
            // Game Revealed (Oracle)
            else if (eventSig === GAME_REVEALED) {
                const sessionId = log.topics[1];
                const game = oracleGames.get(sessionId);
                if (game) {
                    // Decode event data
                    const decoded = marketInterface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });
                    
                    if (!decoded) continue;
                    
                    game.finalized = true;
                    game.revealedAt = new Date(block.header.timestamp);
                    game.outcome = decoded.args.outcome;
                    
                    // Also update corresponding market if it exists
                    const market = markets.get(sessionId);
                    if (market) {
                        market.resolved = true;
                        market.outcome = decoded.args.outcome;
                    }
                }
            }
        }
    }

    // Save to database
    await ctx.store.upsert(Array.from(accounts.values()));
    await ctx.store.upsert(Array.from(markets.values()));
    await ctx.store.insert(trades);
    await ctx.store.upsert(Array.from(positions.values()));
    await ctx.store.upsert(Array.from(oracleGames.values()));
}

