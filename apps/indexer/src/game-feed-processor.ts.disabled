/**
 * Game Feed Processor
 * Indexes GameFeedOracle events for Predimarket
 */

import { ethers } from 'ethers';
import { 
    GameFeedPost, GameMarketUpdate, GamePhaseChange,
    PlayerSkillEvent, PlayerDeathEvent, PlayerKillEvent, PlayerAchievement,
    PlayerStats
} from './model';

// Event ABIs
const FEED_POST_ABI = 'event FeedPostPublished(bytes32 indexed sessionId, bytes32 indexed postId, address indexed author, string content, uint8 gameDay, uint256 timestamp)';
const MARKET_UPDATE_ABI = 'event MarketUpdated(bytes32 indexed sessionId, uint8 yesOdds, uint8 noOdds, uint256 totalVolume, uint8 gameDay, uint256 timestamp)';
const PHASE_CHANGE_ABI = 'event GamePhaseChanged(bytes32 indexed sessionId, string phase, uint8 day, uint256 timestamp)';
const SKILL_EVENT_ABI = 'event SkillLeveledUp(address indexed player, string skillName, uint8 newLevel, uint256 totalXp)';
const DEATH_EVENT_ABI = 'event PlayerDied(address indexed player, address killer, string location, uint256 timestamp)';
const KILL_EVENT_ABI = 'event PlayerKilled(address indexed killer, address indexed victim, string method, uint256 timestamp)';
const ACHIEVEMENT_ABI = 'event AchievementUnlocked(address indexed player, string achievementId, string achievementType, uint256 value)';

const gameFeedInterface = new ethers.Interface([
    FEED_POST_ABI,
    MARKET_UPDATE_ABI,
    PHASE_CHANGE_ABI,
    SKILL_EVENT_ABI,
    DEATH_EVENT_ABI,
    KILL_EVENT_ABI,
    ACHIEVEMENT_ABI
]);

// Event signatures
const FEED_POST = ethers.id('FeedPostPublished(bytes32,bytes32,address,string,uint8,uint256)');
const MARKET_UPDATE = ethers.id('MarketUpdated(bytes32,uint8,uint8,uint256,uint8,uint256)');
const PHASE_CHANGE = ethers.id('GamePhaseChanged(bytes32,string,uint8,uint256)');
const SKILL_EVENT = ethers.id('SkillLeveledUp(address,string,uint8,uint256)');
const DEATH_EVENT = ethers.id('PlayerDied(address,address,string,uint256)');
const KILL_EVENT = ethers.id('PlayerKilled(address,address,string,uint256)');
const ACHIEVEMENT = ethers.id('AchievementUnlocked(address,string,string,uint256)');

export async function processGameFeedEvents(ctx: any) {
    const feedPosts: GameFeedPost[] = [];
    const marketUpdates: GameMarketUpdate[] = [];
    const phaseChanges: GamePhaseChange[] = [];
    const skillEvents: PlayerSkillEvent[] = [];
    const deathEvents: PlayerDeathEvent[] = [];
    const killEvents: PlayerKillEvent[] = [];
    const achievements: PlayerAchievement[] = [];
    const playerStats = new Map<string, PlayerStats>();

    for (let block of ctx.blocks) {
        for (let log of block.logs) {
            const eventSig = log.topics[0];
            
            // Feed Post Published
            if (eventSig === FEED_POST) {
                const decoded = gameFeedInterface.parseLog({
                    topics: log.topics,
                    data: log.data
                });
                
                if (!decoded) continue;
                
                feedPosts.push(new GameFeedPost({
                    id: `${log.transactionHash}-${log.logIndex}`,
                    sessionId: decoded.args.sessionId,
                    postId: decoded.args.postId,
                    author: decoded.args.author,
                    content: decoded.args.content,
                    gameDay: decoded.args.gameDay,
                    timestamp: new Date(Number(decoded.args.timestamp) * 1000),
                    isSystemMessage: decoded.args.author === '0x0000000000000000000000000000000000000000',
                    blockNumber: BigInt(block.header.height),
                    transactionHash: log.transactionHash
                }));
            }
            
            // Market Updated
            else if (eventSig === MARKET_UPDATE) {
                const decoded = gameFeedInterface.parseLog({
                    topics: log.topics,
                    data: log.data
                });
                
                if (!decoded) continue;
                
                marketUpdates.push(new GameMarketUpdate({
                    id: `${log.transactionHash}-${log.logIndex}`,
                    sessionId: decoded.args.sessionId,
                    yesOdds: decoded.args.yesOdds,
                    noOdds: decoded.args.noOdds,
                    totalVolume: BigInt(decoded.args.totalVolume.toString()),
                    gameDay: decoded.args.gameDay,
                    timestamp: new Date(Number(decoded.args.timestamp) * 1000),
                    blockNumber: BigInt(block.header.height),
                    transactionHash: log.transactionHash
                }));
            }
            
            // Game Phase Changed
            else if (eventSig === PHASE_CHANGE) {
                const decoded = gameFeedInterface.parseLog({
                    topics: log.topics,
                    data: log.data
                });
                
                if (!decoded) continue;
                
                phaseChanges.push(new GamePhaseChange({
                    id: `${log.transactionHash}-${log.logIndex}`,
                    sessionId: decoded.args.sessionId,
                    phase: decoded.args.phase,
                    day: decoded.args.day,
                    timestamp: new Date(Number(decoded.args.timestamp) * 1000),
                    blockNumber: BigInt(block.header.height),
                    transactionHash: log.transactionHash
                }));
            }
            
            // Player Skill Leveled Up
            else if (eventSig === SKILL_EVENT) {
                const decoded = gameFeedInterface.parseLog({
                    topics: log.topics,
                    data: log.data
                });
                
                if (!decoded) continue;
                
                const player = decoded.args.player.toLowerCase();
                
                skillEvents.push(new PlayerSkillEvent({
                    id: `${log.transactionHash}-${log.logIndex}`,
                    player,
                    skillName: decoded.args.skillName,
                    newLevel: decoded.args.newLevel,
                    totalXp: BigInt(decoded.args.totalXp.toString()),
                    timestamp: new Date(block.header.timestamp * 1000),
                    blockNumber: BigInt(block.header.height),
                    transactionHash: log.transactionHash
                }));
                
                // Update player stats
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
                        lastActive: new Date(block.header.timestamp * 1000)
                    });
                    playerStats.set(player, stats);
                }
                stats.totalSkillEvents++;
                if (decoded.args.newLevel > stats.highestSkillLevel) {
                    stats.highestSkillLevel = decoded.args.newLevel;
                    stats.highestSkillName = decoded.args.skillName;
                }
                stats.lastActive = new Date(block.header.timestamp * 1000);
            }
            
            // Player Died
            else if (eventSig === DEATH_EVENT) {
                const decoded = gameFeedInterface.parseLog({
                    topics: log.topics,
                    data: log.data
                });
                
                if (!decoded) continue;
                
                const player = decoded.args.player.toLowerCase();
                
                deathEvents.push(new PlayerDeathEvent({
                    id: `${log.transactionHash}-${log.logIndex}`,
                    player,
                    killer: decoded.args.killer !== '0x0000000000000000000000000000000000000000' ? decoded.args.killer.toLowerCase() : null,
                    location: decoded.args.location,
                    timestamp: new Date(Number(decoded.args.timestamp) * 1000),
                    blockNumber: BigInt(block.header.height),
                    transactionHash: log.transactionHash
                }));
                
                // Update player stats
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
                        lastActive: new Date(block.header.timestamp * 1000)
                    });
                    playerStats.set(player, stats);
                }
                stats.totalDeaths++;
                stats.lastActive = new Date(block.header.timestamp * 1000);
            }
            
            // Player Killed
            else if (eventSig === KILL_EVENT) {
                const decoded = gameFeedInterface.parseLog({
                    topics: log.topics,
                    data: log.data
                });
                
                if (!decoded) continue;
                
                const killer = decoded.args.killer.toLowerCase();
                
                killEvents.push(new PlayerKillEvent({
                    id: `${log.transactionHash}-${log.logIndex}`,
                    killer,
                    victim: decoded.args.victim.toLowerCase(),
                    method: decoded.args.method,
                    timestamp: new Date(Number(decoded.args.timestamp) * 1000),
                    blockNumber: BigInt(block.header.height),
                    transactionHash: log.transactionHash
                }));
                
                // Update killer stats
                let stats = playerStats.get(killer);
                if (!stats) {
                    stats = new PlayerStats({
                        id: killer,
                        player: killer,
                        totalSkillEvents: 0,
                        totalDeaths: 0,
                        totalKills: 0,
                        totalAchievements: 0,
                        highestSkillLevel: 0,
                        lastActive: new Date(block.header.timestamp * 1000)
                    });
                    playerStats.set(killer, stats);
                }
                stats.totalKills++;
                stats.lastActive = new Date(block.header.timestamp * 1000);
            }
            
            // Achievement Unlocked
            else if (eventSig === ACHIEVEMENT) {
                const decoded = gameFeedInterface.parseLog({
                    topics: log.topics,
                    data: log.data
                });
                
                if (!decoded) continue;
                
                const player = decoded.args.player.toLowerCase();
                
                achievements.push(new PlayerAchievement({
                    id: `${log.transactionHash}-${log.logIndex}`,
                    player,
                    achievementId: decoded.args.achievementId,
                    achievementType: decoded.args.achievementType,
                    value: BigInt(decoded.args.value.toString()),
                    timestamp: new Date(block.header.timestamp * 1000),
                    blockNumber: BigInt(block.header.height),
                    transactionHash: log.transactionHash
                }));
                
                // Update player stats
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
                        lastActive: new Date(block.header.timestamp * 1000)
                    });
                    playerStats.set(player, stats);
                }
                stats.totalAchievements++;
                stats.lastActive = new Date(block.header.timestamp * 1000);
            }
        }
    }

    // Save to database
    await ctx.store.insert(feedPosts);
    await ctx.store.insert(marketUpdates);
    await ctx.store.insert(phaseChanges);
    await ctx.store.insert(skillEvents);
    await ctx.store.insert(deathEvents);
    await ctx.store.insert(killEvents);
    await ctx.store.insert(achievements);
    await ctx.store.upsert(Array.from(playerStats.values()));
}

