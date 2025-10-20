/**
 * Comprehensive Event Signature Registry
 * 
 * This file contains event signatures for ALL contracts deployed on Jeju.
 * The indexer uses these to decode and categorize events for Grafana visualization.
 * 
 * Event signatures are keccak256 hashes of the event signature.
 * Calculate with: keccak256("EventName(type1,type2,...)")
 */

import { ethers } from 'ethers';

// Helper to calculate event signatures
export function eventSig(signature: string): string {
  return ethers.id(signature);
}

// ============ ERC Token Standards ============

export const ERC20_TRANSFER = eventSig('Transfer(address,address,uint256)');
export const ERC20_APPROVAL = eventSig('Approval(address,address,uint256)');
export const ERC721_TRANSFER = eventSig('Transfer(address,address,uint256)');
export const ERC721_APPROVAL_FOR_ALL = eventSig('ApprovalForAll(address,address,bool)');
export const ERC1155_TRANSFER_SINGLE = eventSig('TransferSingle(address,address,address,uint256,uint256)');
export const ERC1155_TRANSFER_BATCH = eventSig('TransferBatch(address,address,address,uint256[],uint256[])');

// ============ Paymaster & Liquidity System ============

export const TRANSACTION_SPONSORED = eventSig('TransactionSponsored(address,address,uint256,uint256)');
export const FEE_MARGIN_UPDATED = eventSig('FeeMarginUpdated(uint256,uint256)');
export const FEES_DISTRIBUTED = eventSig('FeesDistributed(address,uint256,uint256,uint256,uint256,uint256)');
export const APP_CLAIMED = eventSig('AppClaimed(address,uint256)');
export const ETH_ADDED = eventSig('ETHAdded(address,uint256,uint256)');
export const ETH_REMOVED = eventSig('ETHRemoved(address,uint256,uint256)');
export const ELIZA_ADDED = eventSig('ElizaAdded(address,uint256,uint256)');
export const ELIZA_REMOVED = eventSig('ElizaRemoved(address,uint256,uint256)');
export const FEES_CLAIMED = eventSig('FeesClaimed(address,uint256)');
export const ENTRY_POINT_FUNDED = eventSig('EntryPointFunded(uint256)');

// ============ Cloud Service System ============

export const SERVICE_REGISTERED = eventSig('ServiceRegistered(string,uint256,uint256,uint256)');
export const SERVICE_USAGE_RECORDED = eventSig('ServiceUsageRecorded(address,string,uint256,bytes32,uint256)');
export const CREDIT_DEPOSITED = eventSig('CreditDeposited(address,address,uint256,uint256)');
export const CREDIT_DEDUCTED = eventSig('CreditDeducted(address,address,address,uint256,uint256)');
export const CREDITS_PURCHASED = eventSig('CreditsPurchased(address,address,address,uint256,uint256,uint256,uint256)');

// ============ Hyperscape Game Events ============

export const PLAYER_REGISTERED = eventSig('PlayerRegistered(address,string)');
export const PLAYER_MOVED = eventSig('PlayerMoved(address,int32,int32,int32)');
export const PLAYER_DIED = eventSig('PlayerDied(address,int32,int32,int32)');
export const LEVEL_UP = eventSig('LevelUp(address,uint8,uint8)');
export const XP_GAINED = eventSig('XPGained(address,uint8,uint32)');
export const ATTACK_STARTED = eventSig('AttackStarted(address,bytes32)');
export const DAMAGE_DEALT = eventSig('DamageDealt(address,bytes32,uint32)');
export const MOB_KILLED = eventSig('MobKilled(address,bytes32,uint256)');
export const LOOT_DROPPED = eventSig('LootDropped(bytes32,uint16,uint32)');
export const ITEM_EQUIPPED = eventSig('ItemEquipped(address,uint8,uint16)');
export const ITEM_ADDED = eventSig('ItemAdded(address,uint16,uint32,uint8)');
export const GOLD_CLAIMED = eventSig('GoldClaimed(address,uint256,uint256)');
export const ITEM_MINTED = eventSig('ItemMinted(address,uint256,string,bytes32)');
export const ITEM_BURNED = eventSig('ItemBurned(address,uint256,bytes32)');

// ============ Marketplace Events ============

export const LISTING_CREATED = eventSig('ListingCreated(uint256,address,address,uint256,uint8,uint256)');
export const LISTING_SOLD = eventSig('ListingSold(uint256,address,address,uint256,uint8)');
export const LISTING_CANCELLED = eventSig('ListingCancelled(uint256,address)');
export const TRADE_CREATED = eventSig('TradeCreated(uint256,address,address)');
export const TRADE_EXECUTED = eventSig('TradeExecuted(uint256,address,address)');
export const TRADE_CANCELLED = eventSig('TradeCancelled(uint256,address)');

// ============ Prediction Market Events ============

export const MARKET_CREATED = eventSig('MarketCreated(bytes32,string,uint256)');
export const SHARES_PURCHASED = eventSig('SharesPurchased(bytes32,address,bool,uint256,uint256,address)');
export const SHARES_SOLD = eventSig('SharesSold(bytes32,address,bool,uint256,uint256,address)');
export const MARKET_RESOLVED = eventSig('MarketResolved(bytes32,bool)');
export const PAYOUT_CLAIMED = eventSig('PayoutClaimed(bytes32,address,uint256)');
export const GAME_COMMITTED = eventSig('GameCommitted(bytes32,string,bytes32,uint256)');
export const GAME_REVEALED = eventSig('GameRevealed(bytes32,bool,uint256,bytes,uint256)');

// ============ Oracle Events ============

export const FEED_POST_PUBLISHED = eventSig('FeedPostPublished(bytes32,bytes32,address,string,uint8,uint256)');
export const MARKET_UPDATED = eventSig('MarketUpdated(bytes32,uint8,uint8,uint256,uint8,uint256)');
export const SKILL_LEVEL_UP = eventSig('SkillLevelUp(address,string,uint8,uint256,uint256)');
export const PLAYER_DEATH = eventSig('PlayerDeath(address,address,string,uint256)');
export const PLAYER_KILL = eventSig('PlayerKill(address,address,string,uint256)');
export const PLAYER_ACHIEVEMENT = eventSig('PlayerAchievement(address,bytes32,string,uint256,uint256)');
export const PREDICTION_CREATED = eventSig('PredictionCreated(bytes32,string,address,uint256,bytes32)');
export const PREDICTION_RESOLVED = eventSig('PredictionResolved(bytes32,bool,uint256)');
export const PRICES_UPDATED = eventSig('PricesUpdated(uint256,uint256,uint256)');

// ============ ERC-8004 Agent Registry Events ============

export const AGENT_REGISTERED = eventSig('Registered(uint256,string,address)');
export const METADATA_SET = eventSig('MetadataSet(uint256,string,string,bytes)');
export const NEW_FEEDBACK = eventSig('NewFeedback(uint256,address,uint8,bytes32,bytes32,string,bytes32)');
export const FEEDBACK_REVOKED = eventSig('FeedbackRevoked(uint256,address,uint64)');
export const VALIDATION_REQUEST = eventSig('ValidationRequest(address,uint256,string,bytes32)');
export const VALIDATION_RESPONSE = eventSig('ValidationResponse(address,uint256,bytes32,uint8,string,bytes32,bytes32)');

// ============ Node Staking Events (Multi-Token) ============

export const NODE_REGISTERED = eventSig('NodeRegistered(bytes32,address,address,address,uint256,uint256)');
export const NODE_DEREGISTERED = eventSig('NodeDeregistered(bytes32,address)');
export const PERFORMANCE_UPDATED = eventSig('PerformanceUpdated(bytes32,uint256,uint256,uint256)');
export const REWARDS_CLAIMED = eventSig('RewardsClaimed(bytes32,address,address,uint256,uint256)');
export const NODE_SLASHED = eventSig('NodeSlashed(bytes32,address,uint256,string)');
export const PAYMASTER_FEE_DISTRIBUTED = eventSig('PaymasterFeeDistributed(address,uint256,string)');

// ============ Paymaster Factory Events ============

export const PAYMASTER_DEPLOYED = eventSig('PaymasterDeployed(address,address,address,address,address,uint256,uint256)');
export const TOKEN_REGISTERED = eventSig('TokenRegistered(address,address,string,string,address,uint256,uint256,uint256)');
export const TOKEN_ACTIVATED = eventSig('TokenActivated(address,address)');
export const TOKEN_DEACTIVATED = eventSig('TokenDeactivated(address,address)');

// ============ Event Category Mapping ============

export interface EventCategory {
  signature: string;
  name: string;
  category: 'token' | 'paymaster' | 'cloud' | 'game' | 'marketplace' | 'prediction' | 'registry' | 'node' | 'oracle' | 'defi';
  contract: string;
}

export const EVENT_REGISTRY: Record<string, EventCategory> = {
  // Token events
  [ERC20_TRANSFER]: { signature: ERC20_TRANSFER, name: 'Transfer', category: 'token', contract: 'ERC20' },
  [ERC20_APPROVAL]: { signature: ERC20_APPROVAL, name: 'Approval', category: 'token', contract: 'ERC20' },
  [ERC1155_TRANSFER_SINGLE]: { signature: ERC1155_TRANSFER_SINGLE, name: 'TransferSingle', category: 'token', contract: 'ERC1155' },
  
  // Paymaster events
  [TRANSACTION_SPONSORED]: { signature: TRANSACTION_SPONSORED, name: 'TransactionSponsored', category: 'paymaster', contract: 'LiquidityPaymaster' },
  [FEES_DISTRIBUTED]: { signature: FEES_DISTRIBUTED, name: 'FeesDistributed', category: 'paymaster', contract: 'FeeDistributor' },
  [ETH_ADDED]: { signature: ETH_ADDED, name: 'ETHAdded', category: 'paymaster', contract: 'LiquidityVault' },
  [ETH_REMOVED]: { signature: ETH_REMOVED, name: 'ETHRemoved', category: 'paymaster', contract: 'LiquidityVault' },
  [FEES_CLAIMED]: { signature: FEES_CLAIMED, name: 'FeesClaimed', category: 'paymaster', contract: 'LiquidityVault' },
  
  // Cloud service events
  [SERVICE_REGISTERED]: { signature: SERVICE_REGISTERED, name: 'ServiceRegistered', category: 'cloud', contract: 'ServiceRegistry' },
  [SERVICE_USAGE_RECORDED]: { signature: SERVICE_USAGE_RECORDED, name: 'ServiceUsageRecorded', category: 'cloud', contract: 'ServiceRegistry' },
  [CREDIT_DEPOSITED]: { signature: CREDIT_DEPOSITED, name: 'CreditDeposited', category: 'cloud', contract: 'CreditManager' },
  [CREDITS_PURCHASED]: { signature: CREDITS_PURCHASED, name: 'CreditsPurchased', category: 'cloud', contract: 'CreditPurchaseContract' },
  
  // Game events
  [PLAYER_REGISTERED]: { signature: PLAYER_REGISTERED, name: 'PlayerRegistered', category: 'game', contract: 'Hyperscape' },
  [PLAYER_MOVED]: { signature: PLAYER_MOVED, name: 'PlayerMoved', category: 'game', contract: 'Hyperscape' },
  [PLAYER_DIED]: { signature: PLAYER_DIED, name: 'PlayerDied', category: 'game', contract: 'Hyperscape' },
  [LEVEL_UP]: { signature: LEVEL_UP, name: 'LevelUp', category: 'game', contract: 'Hyperscape' },
  [XP_GAINED]: { signature: XP_GAINED, name: 'XPGained', category: 'game', contract: 'Hyperscape' },
  [MOB_KILLED]: { signature: MOB_KILLED, name: 'MobKilled', category: 'game', contract: 'Hyperscape' },
  [GOLD_CLAIMED]: { signature: GOLD_CLAIMED, name: 'GoldClaimed', category: 'game', contract: 'HyperscapeGold' },
  [ITEM_MINTED]: { signature: ITEM_MINTED, name: 'ItemMinted', category: 'game', contract: 'HyperscapeItems' },
  
  // Marketplace events
  [LISTING_CREATED]: { signature: LISTING_CREATED, name: 'ListingCreated', category: 'marketplace', contract: 'Bazaar' },
  [LISTING_SOLD]: { signature: LISTING_SOLD, name: 'ListingSold', category: 'marketplace', contract: 'Bazaar' },
  [TRADE_EXECUTED]: { signature: TRADE_EXECUTED, name: 'TradeExecuted', category: 'marketplace', contract: 'PlayerTradeEscrow' },
  
  // Prediction market events
  [MARKET_CREATED]: { signature: MARKET_CREATED, name: 'MarketCreated', category: 'prediction', contract: 'Predimarket' },
  [SHARES_PURCHASED]: { signature: SHARES_PURCHASED, name: 'SharesPurchased', category: 'prediction', contract: 'Predimarket' },
  [SHARES_SOLD]: { signature: SHARES_SOLD, name: 'SharesSold', category: 'prediction', contract: 'Predimarket' },
  [MARKET_RESOLVED]: { signature: MARKET_RESOLVED, name: 'MarketResolved', category: 'prediction', contract: 'Predimarket' },
  [GAME_COMMITTED]: { signature: GAME_COMMITTED, name: 'GameCommitted', category: 'prediction', contract: 'PredictionOracle' },
  [GAME_REVEALED]: { signature: GAME_REVEALED, name: 'GameRevealed', category: 'prediction', contract: 'PredictionOracle' },
  
  // Oracle events
  [FEED_POST_PUBLISHED]: { signature: FEED_POST_PUBLISHED, name: 'FeedPostPublished', category: 'oracle', contract: 'GameFeedOracle' },
  [MARKET_UPDATED]: { signature: MARKET_UPDATED, name: 'MarketUpdated', category: 'oracle', contract: 'GameFeedOracle' },
  [SKILL_LEVEL_UP]: { signature: SKILL_LEVEL_UP, name: 'SkillLevelUp', category: 'oracle', contract: 'HyperscapeOracle' },
  [PRICES_UPDATED]: { signature: PRICES_UPDATED, name: 'PricesUpdated', category: 'oracle', contract: 'ManualPriceOracle' },
  
  // Registry events
  [AGENT_REGISTERED]: { signature: AGENT_REGISTERED, name: 'Registered', category: 'registry', contract: 'IdentityRegistry' },
  [METADATA_SET]: { signature: METADATA_SET, name: 'MetadataSet', category: 'registry', contract: 'IdentityRegistry' },
  [NEW_FEEDBACK]: { signature: NEW_FEEDBACK, name: 'NewFeedback', category: 'registry', contract: 'ReputationRegistry' },
  [VALIDATION_REQUEST]: { signature: VALIDATION_REQUEST, name: 'ValidationRequest', category: 'registry', contract: 'ValidationRegistry' },
  
  // Node staking events (multi-token)
  [NODE_REGISTERED]: { signature: NODE_REGISTERED, name: 'NodeRegistered', category: 'node', contract: 'NodeStakingManager' },
  [PERFORMANCE_UPDATED]: { signature: PERFORMANCE_UPDATED, name: 'PerformanceUpdated', category: 'node', contract: 'NodeStakingManager' },
  [REWARDS_CLAIMED]: { signature: REWARDS_CLAIMED, name: 'RewardsClaimed', category: 'node', contract: 'NodeStakingManager' },
  [PAYMASTER_FEE_DISTRIBUTED]: { signature: PAYMASTER_FEE_DISTRIBUTED, name: 'PaymasterFeeDistributed', category: 'node', contract: 'NodeStakingManager' },
  
  // Factory events
  [PAYMASTER_DEPLOYED]: { signature: PAYMASTER_DEPLOYED, name: 'PaymasterDeployed', category: 'paymaster', contract: 'PaymasterFactory' },
  [TOKEN_REGISTERED]: { signature: TOKEN_REGISTERED, name: 'TokenRegistered', category: 'paymaster', contract: 'TokenRegistry' },
};

// ============ Contract Type Detection ============

export function getEventCategory(topic0: string): EventCategory | null {
  return EVENT_REGISTRY[topic0] || null;
}

export function isKnownEvent(topic0: string): boolean {
  return topic0 in EVENT_REGISTRY;
}

// ============ Event Signature Lists by Category ============

export const PAYMASTER_EVENTS = [
  TRANSACTION_SPONSORED,
  FEES_DISTRIBUTED,
  APP_CLAIMED,
  ETH_ADDED,
  ETH_REMOVED,
  FEES_CLAIMED,
  ENTRY_POINT_FUNDED,
  PAYMASTER_DEPLOYED,
];

export const GAME_EVENTS = [
  PLAYER_REGISTERED,
  PLAYER_MOVED,
  PLAYER_DIED,
  LEVEL_UP,
  XP_GAINED,
  MOB_KILLED,
  GOLD_CLAIMED,
  ITEM_MINTED,
  ITEM_EQUIPPED,
  ITEM_ADDED,
];

export const MARKETPLACE_EVENTS = [
  LISTING_CREATED,
  LISTING_SOLD,
  LISTING_CANCELLED,
  TRADE_CREATED,
  TRADE_EXECUTED,
  TRADE_CANCELLED,
];

export const PREDICTION_EVENTS = [
  MARKET_CREATED,
  SHARES_PURCHASED,
  SHARES_SOLD,
  MARKET_RESOLVED,
  GAME_COMMITTED,
  GAME_REVEALED,
  PAYOUT_CLAIMED,
];

export const CLOUD_EVENTS = [
  SERVICE_REGISTERED,
  SERVICE_USAGE_RECORDED,
  CREDIT_DEPOSITED,
  CREDIT_DEDUCTED,
  CREDITS_PURCHASED,
];

export const REGISTRY_EVENTS = [
  AGENT_REGISTERED,
  METADATA_SET,
  NEW_FEEDBACK,
  VALIDATION_REQUEST,
];

export const NODE_EVENTS = [
  NODE_REGISTERED,
  NODE_DEREGISTERED,
  PERFORMANCE_UPDATED,
  REWARDS_CLAIMED,
  NODE_SLASHED,
  PAYMASTER_FEE_DISTRIBUTED,
];

export const ORACLE_EVENTS = [
  FEED_POST_PUBLISHED,
  MARKET_UPDATED,
  SKILL_LEVEL_UP,
  PRICES_UPDATED,
];

// ============ All Known Events ============

export const ALL_KNOWN_EVENTS = [
  ...PAYMASTER_EVENTS,
  ...GAME_EVENTS,
  ...MARKETPLACE_EVENTS,
  ...PREDICTION_EVENTS,
  ...CLOUD_EVENTS,
  ...REGISTRY_EVENTS,
  ...NODE_EVENTS,
  ...ORACLE_EVENTS,
];

// ============ Contract Address Mapping (filled at runtime) ============

export interface ContractInfo {
  address: string;
  name: string;
  type: 'paymaster' | 'cloud' | 'game' | 'marketplace' | 'prediction' | 'registry' | 'node' | 'oracle' | 'token' | 'defi';
  events: string[];
}

// Contract registry - populated from deployment artifacts
export const CONTRACT_REGISTRY: Map<string, ContractInfo> = new Map();

export function registerContract(info: ContractInfo) {
  CONTRACT_REGISTRY.set(info.address.toLowerCase(), info);
}

export function getContractInfo(address: string): ContractInfo | undefined {
  return CONTRACT_REGISTRY.get(address.toLowerCase());
}

// ============ Event Name Mapping ============

export const EVENT_NAMES: Record<string, string> = {
  [ERC20_TRANSFER]: 'Transfer',
  [ERC20_APPROVAL]: 'Approval',
  [ERC1155_TRANSFER_SINGLE]: 'TransferSingle',
  [TRANSACTION_SPONSORED]: 'TransactionSponsored',
  [FEES_DISTRIBUTED]: 'FeesDistributed',
  [ETH_ADDED]: 'ETHAdded',
  [FEES_CLAIMED]: 'FeesClaimed',
  [SERVICE_REGISTERED]: 'ServiceRegistered',
  [SERVICE_USAGE_RECORDED]: 'ServiceUsageRecorded',
  [CREDIT_DEPOSITED]: 'CreditDeposited',
  [CREDITS_PURCHASED]: 'CreditsPurchased',
  [PLAYER_REGISTERED]: 'PlayerRegistered',
  [PLAYER_MOVED]: 'PlayerMoved',
  [PLAYER_DIED]: 'PlayerDied',
  [LEVEL_UP]: 'LevelUp',
  [XP_GAINED]: 'XPGained',
  [MOB_KILLED]: 'MobKilled',
  [GOLD_CLAIMED]: 'GoldClaimed',
  [ITEM_MINTED]: 'ItemMinted',
  [LISTING_CREATED]: 'ListingCreated',
  [LISTING_SOLD]: 'ListingSold',
  [TRADE_EXECUTED]: 'TradeExecuted',
  [MARKET_CREATED]: 'MarketCreated',
  [SHARES_PURCHASED]: 'SharesPurchased',
  [SHARES_SOLD]: 'SharesSold',
  [MARKET_RESOLVED]: 'MarketResolved',
  [GAME_COMMITTED]: 'GameCommitted',
  [GAME_REVEALED]: 'GameRevealed',
  [AGENT_REGISTERED]: 'AgentRegistered',
  [NEW_FEEDBACK]: 'NewFeedback',
  [VALIDATION_REQUEST]: 'ValidationRequest',
  [NODE_REGISTERED]: 'NodeRegistered',
  [PERFORMANCE_UPDATED]: 'PerformanceUpdated',
  [REWARDS_CLAIMED]: 'RewardsClaimed',
  [PAYMASTER_DEPLOYED]: 'PaymasterDeployed',
  [TOKEN_REGISTERED]: 'TokenRegistered',
  [PRICES_UPDATED]: 'PricesUpdated',
  [FEED_POST_PUBLISHED]: 'FeedPostPublished',
  [MARKET_UPDATED]: 'MarketUpdated',
  [SKILL_LEVEL_UP]: 'SkillLevelUp',
};

export function getEventName(topic0: string): string {
  return EVENT_NAMES[topic0] || 'Unknown';
}

