/**
 * Game Feed Processor - Indexes GameFeedOracle events
 */

import { ethers } from 'ethers';
import { Store } from '@subsquid/typeorm-store';
import { ProcessorContext } from './processor';
import { 
    GameFeedPost, GameMarketUpdate, GamePhaseChange,
    PlayerSkillEvent, PlayerDeathEvent, PlayerKillEvent, PlayerAchievement,
    PlayerStats
} from './model';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const gameFeedInterface = new ethers.Interface([
    'event FeedPostPublished(bytes32 indexed sessionId, bytes32 indexed postId, address indexed author, string content, uint8 gameDay, uint256 timestamp)',
    'event MarketUpdated(bytes32 indexed sessionId, uint8 yesOdds, uint8 noOdds, uint256 totalVolume, uint8 gameDay, uint256 timestamp)',
    'event GamePhaseChanged(bytes32 indexed sessionId, string phase, uint8 day, uint256 timestamp)',
    'event SkillLeveledUp(address indexed player, string skillName, uint8 newLevel, uint256 totalXp)',
    'event PlayerDied(address indexed player, address killer, string location, uint256 timestamp)',
    'event PlayerKilled(address indexed killer, address indexed victim, string method, uint256 timestamp)',
    'event AchievementUnlocked(address indexed player, string achievementId, string achievementType, uint256 value)'
]);

const FEED_POST = ethers.id('FeedPostPublished(bytes32,bytes32,address,string,uint8,uint256)');
const MARKET_UPDATE = ethers.id('MarketUpdated(bytes32,uint8,uint8,uint256,uint8,uint256)');
const PHASE_CHANGE = ethers.id('GamePhaseChanged(bytes32,string,uint8,uint256)');
const SKILL_EVENT = ethers.id('SkillLeveledUp(address,string,uint8,uint256)');
const DEATH_EVENT = ethers.id('PlayerDied(address,address,string,uint256)');
const KILL_EVENT = ethers.id('PlayerKilled(address,address,string,uint256)');
const ACHIEVEMENT = ethers.id('AchievementUnlocked(address,string,string,uint256)');

function getOrCreatePlayerStats(playerStats: Map<string, PlayerStats>, player: string, timestamp: Date): PlayerStats {
    let stats = playerStats.get(player);
    if (!stats) {
        stats = new PlayerStats({
            id: player,
            player,
            totalSkillEvents: 0,
            totalDeaths: 0,
            totalKills: 0,
            totalAchievements: 0,
            highestSkillLevel: 0,
            lastActive: timestamp
        });
        playerStats.set(player, stats);
    }
    return stats;
}

export async function processGameFeedEvents(ctx: ProcessorContext<Store>): Promise<void> {
    const feedPosts: GameFeedPost[] = [];
    const marketUpdates: GameMarketUpdate[] = [];
    const phaseChanges: GamePhaseChange[] = [];
    const skillEvents: PlayerSkillEvent[] = [];
    const deathEvents: PlayerDeathEvent[] = [];
    const killEvents: PlayerKillEvent[] = [];
    const achievements: PlayerAchievement[] = [];
    const playerStats = new Map<string, PlayerStats>();

    for (const block of ctx.blocks) {
        const blockTimestamp = new Date(block.header.timestamp);
        
        for (const log of block.logs) {
            const eventSig = log.topics[0];
            if (!log.transaction) continue;
            const txHash = log.transaction.hash;
            
            if (eventSig === FEED_POST) {
                const decoded = gameFeedInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                feedPosts.push(new GameFeedPost({
                    id: `${txHash}-${log.logIndex}`,
                    sessionId: decoded.args.sessionId,
                    postId: decoded.args.postId,
                    author: decoded.args.author,
                    content: decoded.args.content,
                    gameDay: decoded.args.gameDay,
                    timestamp: new Date(Number(decoded.args.timestamp) * 1000),
                    isSystemMessage: decoded.args.author === ZERO_ADDRESS,
                    blockNumber: BigInt(block.header.height),
                    transactionHash: txHash
                }));
            }
            else if (eventSig === MARKET_UPDATE) {
                const decoded = gameFeedInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                marketUpdates.push(new GameMarketUpdate({
                    id: `${txHash}-${log.logIndex}`,
                    sessionId: decoded.args.sessionId,
                    yesOdds: decoded.args.yesOdds,
                    noOdds: decoded.args.noOdds,
                    totalVolume: BigInt(decoded.args.totalVolume.toString()),
                    gameDay: decoded.args.gameDay,
                    timestamp: new Date(Number(decoded.args.timestamp) * 1000),
                    blockNumber: BigInt(block.header.height),
                    transactionHash: txHash
                }));
            }
            else if (eventSig === PHASE_CHANGE) {
                const decoded = gameFeedInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                phaseChanges.push(new GamePhaseChange({
                    id: `${txHash}-${log.logIndex}`,
                    sessionId: decoded.args.sessionId,
                    phase: decoded.args.phase,
                    day: decoded.args.day,
                    timestamp: new Date(Number(decoded.args.timestamp) * 1000),
                    blockNumber: BigInt(block.header.height),
                    transactionHash: txHash
                }));
            }
            else if (eventSig === SKILL_EVENT) {
                const decoded = gameFeedInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                const player = decoded.args.player.toLowerCase();
                
                skillEvents.push(new PlayerSkillEvent({
                    id: `${txHash}-${log.logIndex}`,
                    player,
                    skillName: decoded.args.skillName,
                    newLevel: decoded.args.newLevel,
                    totalXp: BigInt(decoded.args.totalXp.toString()),
                    timestamp: blockTimestamp,
                    blockNumber: BigInt(block.header.height),
                    transactionHash: txHash
                }));
                
                const stats = getOrCreatePlayerStats(playerStats, player, blockTimestamp);
                stats.totalSkillEvents++;
                if (decoded.args.newLevel > stats.highestSkillLevel) {
                    stats.highestSkillLevel = decoded.args.newLevel;
                    stats.highestSkillName = decoded.args.skillName;
                }
                stats.lastActive = blockTimestamp;
            }
            else if (eventSig === DEATH_EVENT) {
                const decoded = gameFeedInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                const player = decoded.args.player.toLowerCase();
                const killerAddr = decoded.args.killer;
                
                deathEvents.push(new PlayerDeathEvent({
                    id: `${txHash}-${log.logIndex}`,
                    player,
                    killer: killerAddr !== ZERO_ADDRESS ? killerAddr.toLowerCase() : null,
                    location: decoded.args.location,
                    timestamp: new Date(Number(decoded.args.timestamp) * 1000),
                    blockNumber: BigInt(block.header.height),
                    transactionHash: txHash
                }));
                
                const stats = getOrCreatePlayerStats(playerStats, player, blockTimestamp);
                stats.totalDeaths++;
                stats.lastActive = blockTimestamp;
            }
            else if (eventSig === KILL_EVENT) {
                const decoded = gameFeedInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                const killer = decoded.args.killer.toLowerCase();
                
                killEvents.push(new PlayerKillEvent({
                    id: `${txHash}-${log.logIndex}`,
                    killer,
                    victim: decoded.args.victim.toLowerCase(),
                    method: decoded.args.method,
                    timestamp: new Date(Number(decoded.args.timestamp) * 1000),
                    blockNumber: BigInt(block.header.height),
                    transactionHash: txHash
                }));
                
                const stats = getOrCreatePlayerStats(playerStats, killer, blockTimestamp);
                stats.totalKills++;
                stats.lastActive = blockTimestamp;
            }
            else if (eventSig === ACHIEVEMENT) {
                const decoded = gameFeedInterface.parseLog({ topics: log.topics, data: log.data });
                if (!decoded) continue;
                
                const player = decoded.args.player.toLowerCase();
                
                achievements.push(new PlayerAchievement({
                    id: `${txHash}-${log.logIndex}`,
                    player,
                    achievementId: decoded.args.achievementId,
                    achievementType: decoded.args.achievementType,
                    value: BigInt(decoded.args.value.toString()),
                    timestamp: blockTimestamp,
                    blockNumber: BigInt(block.header.height),
                    transactionHash: txHash
                }));
                
                const stats = getOrCreatePlayerStats(playerStats, player, blockTimestamp);
                stats.totalAchievements++;
                stats.lastActive = blockTimestamp;
            }
        }
    }

    await ctx.store.insert(feedPosts);
    await ctx.store.insert(marketUpdates);
    await ctx.store.insert(phaseChanges);
    await ctx.store.insert(skillEvents);
    await ctx.store.insert(deathEvents);
    await ctx.store.insert(killEvents);
    await ctx.store.insert(achievements);
    await ctx.store.upsert([...playerStats.values()]);
}
