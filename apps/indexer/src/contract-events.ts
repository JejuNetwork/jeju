/**
 * Comprehensive Event Signature Registry
 * 
 * IMPORTANT: All event signatures are derived from ACTUAL Solidity contracts.
 * Event signatures are keccak256 hashes calculated as: keccak256("EventName(type1,type2,...)")
 * 
 * Note: indexed parameters don't affect the signature - all param types are included.
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
// Gold.sol events
export const GOLD_CLAIMED = eventSig('GoldClaimed(address,uint256,uint256)');
export const GOLD_BURNED = eventSig('GoldBurned(address,uint256)');
export const GOLD_SIGNER_UPDATED = eventSig('GameSignerUpdated(address,address)');

// Items.sol events (ERC-1155 game items)
export const ITEM_MINTED = eventSig('ItemMinted(address,uint256,uint256,bytes32,bool,uint8)');
export const ITEM_BURNED = eventSig('ItemBurned(address,uint256,uint256)');
export const ITEM_TYPE_CREATED = eventSig('ItemTypeCreated(uint256,string,bool,uint8)');
export const NFT_PROVENANCE = eventSig('NFTProvenance(address,uint256,bytes32,uint256)');

// ============ Marketplace Events (Bazaar.sol) ============

export const LISTING_CREATED = eventSig('ListingCreated(uint256,address,address,uint256,uint8,uint256)');
export const LISTING_SOLD = eventSig('ListingSold(uint256,address,address,uint256,uint8)');
export const LISTING_CANCELLED = eventSig('ListingCancelled(uint256,address)');
export const TRADE_CREATED = eventSig('TradeCreated(uint256,address,address)');
export const TRADE_EXECUTED = eventSig('TradeExecuted(uint256)');
export const TRADE_CANCELLED = eventSig('TradeCancelled(uint256,address)');

// ============ Prediction Market Events (Predimarket.sol) ============

export const MARKET_CREATED = eventSig('MarketCreated(bytes32,string,uint256,uint8,address)');
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

// IdentityRegistry events
export const AGENT_REGISTERED = eventSig('Registered(uint256,address,uint8,uint256,string)');
export const STAKE_INCREASED = eventSig('StakeIncreased(uint256,uint8,uint8,uint256)');
export const STAKE_WITHDRAWN = eventSig('StakeWithdrawn(uint256,address,uint256)');
export const AGENT_BANNED = eventSig('AgentBanned(uint256,string)');
export const AGENT_UNBANNED = eventSig('AgentUnbanned(uint256)');
export const AGENT_SLASHED = eventSig('AgentSlashed(uint256,uint256,string)');
export const TAGS_UPDATED = eventSig('TagsUpdated(uint256,string[])');
export const AGENT_URI_UPDATED = eventSig('AgentUriUpdated(uint256,string)');
export const METADATA_SET = eventSig('MetadataSet(uint256,string,string,bytes)');
export const GOVERNANCE_UPDATED = eventSig('GovernanceUpdated(address,address)');
export const REPUTATION_ORACLE_UPDATED = eventSig('ReputationOracleUpdated(address,address)');
export const STAKE_TOKEN_ADDED = eventSig('StakeTokenAdded(address)');
export const STAKE_TOKEN_REMOVED = eventSig('StakeTokenRemoved(address)');

// ReputationRegistry events
export const NEW_FEEDBACK = eventSig('NewFeedback(uint256,address,uint8,bytes32,bytes32,string,bytes32)');
export const FEEDBACK_REVOKED = eventSig('FeedbackRevoked(uint256,address,uint64)');
export const RESPONSE_APPENDED = eventSig('ResponseAppended(uint256,address,uint64,address,string,bytes32)');

// ValidationRegistry events
export const VALIDATION_REQUEST = eventSig('ValidationRequest(address,uint256,string,bytes32)');
export const VALIDATION_RESPONSE = eventSig('ValidationResponse(address,uint256,bytes32,uint8,string,bytes32,bytes32)');

// ============ BanManager Events ============

export const NETWORK_BAN_APPLIED = eventSig('NetworkBanApplied(uint256,string,bytes32,uint256)');
export const APP_BAN_APPLIED = eventSig('AppBanApplied(uint256,bytes32,string,bytes32,uint256)');
export const NETWORK_BAN_REMOVED = eventSig('NetworkBanRemoved(uint256,uint256)');
export const APP_BAN_REMOVED = eventSig('AppBanRemoved(uint256,bytes32,uint256)');

// ============ ReportingSystem Events ============

export const REPORT_CREATED = eventSig('ReportCreated(uint256,uint256,uint8,uint8,address,bytes32,bytes32)');
export const REPORT_RESOLVED = eventSig('ReportResolved(uint256,bool,uint256)');
export const REPORT_EXECUTED = eventSig('ReportExecuted(uint256,uint256,uint8,uint256)');
export const REPORTER_REWARDED = eventSig('ReporterRewarded(uint256,address,uint256)');
export const REPORTER_SLASHED = eventSig('ReporterSlashed(uint256,address,uint256)');
export const CRITICAL_TEMP_BAN = eventSig('CriticalTempBan(uint256,uint256,bytes32)');

// ============ Node Staking Events (NodeStakingManager.sol) ============

export const NODE_REGISTERED = eventSig('NodeRegistered(bytes32,address,address,address,uint256,uint256)');
export const NODE_DEREGISTERED = eventSig('NodeDeregistered(bytes32,address)');
export const PERFORMANCE_UPDATED = eventSig('PerformanceUpdated(bytes32,uint256,uint256,uint256)');
export const REWARDS_CLAIMED = eventSig('RewardsClaimed(bytes32,address,address,uint256,uint256)');
export const NODE_SLASHED = eventSig('NodeSlashed(bytes32,address,uint256,string)');
export const PAYMASTER_FEE_DISTRIBUTED = eventSig('PaymasterFeeDistributed(address,uint256,string)');

// ============ Compute Registry Events (ComputeRegistry.sol) ============

export const PROVIDER_REGISTERED = eventSig('ProviderRegistered(address,string,string,bytes32,uint256,uint256)');
export const PROVIDER_UPDATED = eventSig('ProviderUpdated(address,string,bytes32)');
export const PROVIDER_DEACTIVATED = eventSig('ProviderDeactivated(address)');
export const PROVIDER_REACTIVATED = eventSig('ProviderReactivated(address)');
export const STAKE_ADDED = eventSig('StakeAdded(address,uint256,uint256)');
export const STAKE_WITHDRAWN_COMPUTE = eventSig('StakeWithdrawn(address,uint256)');
export const CAPABILITY_ADDED = eventSig('CapabilityAdded(address,string,uint256,uint256,uint256)');
export const CAPABILITY_UPDATED = eventSig('CapabilityUpdated(address,uint256,bool)');

// ============ Compute Rental Events (ComputeRental.sol) ============

export const RENTAL_CREATED = eventSig('RentalCreated(bytes32,address,address,uint256,uint256)');
export const RENTAL_STARTED = eventSig('RentalStarted(bytes32,string,uint16,string)');
export const RENTAL_COMPLETED = eventSig('RentalCompleted(bytes32,uint256,uint256)');
export const RENTAL_CANCELLED = eventSig('RentalCancelled(bytes32,uint256)');
export const RENTAL_EXTENDED = eventSig('RentalExtended(bytes32,uint256,uint256)');
export const RENTAL_RATED = eventSig('RentalRated(bytes32,address,uint8,string)');
export const DISPUTE_CREATED = eventSig('DisputeCreated(bytes32,bytes32,address,uint8,string)');
export const DISPUTE_RESOLVED = eventSig('DisputeResolved(bytes32,bool,uint256)');
export const USER_BANNED = eventSig('UserBanned(address,string,uint256)');
export const USER_UNBANNED = eventSig('UserUnbanned(address)');
export const PROVIDER_BANNED = eventSig('ProviderBanned(address,string)');

// ============ Inference Serving Events (InferenceServing.sol) ============

export const SERVICE_REGISTERED_INFERENCE = eventSig('ServiceRegistered(address,uint256,string,string,uint256,uint256)');
export const SERVICE_DEACTIVATED = eventSig('ServiceDeactivated(address,uint256)');
export const SETTLED = eventSig('Settled(address,address,bytes32,uint256,uint256,uint256,uint256)');
export const AGENT_SETTLED = eventSig('AgentSettled(uint256,address,uint256,uint256,uint256)');

// ============ Compute Staking Events (ComputeStaking.sol) ============

export const STAKED_AS_USER = eventSig('StakedAsUser(address,uint256)');
export const STAKED_AS_PROVIDER = eventSig('StakedAsProvider(address,uint256)');
export const STAKED_AS_GUARDIAN = eventSig('StakedAsGuardian(address,uint256)');
export const UNSTAKED = eventSig('Unstaked(address,uint256)');
export const SLASHED = eventSig('Slashed(address,uint256,string)');

// ============ OIF (Open Intents Framework) Events ============

// InputSettler.sol events
export const ORDER_CREATED = eventSig('OrderCreated(bytes32,address,address,uint256,uint256,address,uint32)');
export const ORDER_CLAIMED = eventSig('OrderClaimed(bytes32,address,uint256)');
export const ORDER_SETTLED = eventSig('OrderSettled(bytes32,address,uint256,uint256)');
export const ORDER_REFUNDED = eventSig('OrderRefunded(bytes32,address,uint256)');
export const ORACLE_UPDATED = eventSig('OracleUpdated(address,address)');

// OutputSettler.sol events
export const LIQUIDITY_DEPOSITED = eventSig('LiquidityDeposited(address,address,uint256)');
export const LIQUIDITY_WITHDRAWN = eventSig('LiquidityWithdrawn(address,address,uint256)');
export const ORDER_FILLED = eventSig('OrderFilled(bytes32,address,address,address,uint256)');

// SolverRegistry.sol events
export const SOLVER_REGISTERED = eventSig('SolverRegistered(address,uint256,uint256[])');
export const SOLVER_STAKE_DEPOSITED = eventSig('SolverStakeDeposited(address,uint256,uint256)');
export const SOLVER_SLASHED = eventSig('SolverSlashed(address,bytes32,uint256)');
export const SOLVER_WITHDRAWN = eventSig('SolverWithdrawn(address,uint256)');
export const FILL_RECORDED = eventSig('FillRecorded(address,bytes32,bool)');
export const CHAIN_ADDED = eventSig('ChainAdded(address,uint256)');
export const CHAIN_REMOVED = eventSig('ChainRemoved(address,uint256)');

// HyperlaneOracle.sol events
export const ATTESTATION_SUBMITTED = eventSig('AttestationSubmitted(bytes32,address,uint256)');
export const ATTESTER_UPDATED = eventSig('AttesterUpdated(address,bool)');

// ============ EIL (Ethereum Interop Layer) Events ============

// EILVault.sol events
export const VOUCHER_REQUESTED = eventSig('VoucherRequested(bytes32,address,address,uint256,uint256,address)');
export const VOUCHER_ISSUED = eventSig('VoucherIssued(bytes32,address,uint256,address)');
export const VOUCHER_FULFILLED = eventSig('VoucherFulfilled(bytes32,address,uint256)');
export const VOUCHER_EXPIRED = eventSig('VoucherExpired(bytes32,address,uint256)');
export const FUNDS_REFUNDED = eventSig('FundsRefunded(bytes32,address,uint256)');
export const XLP_DEPOSIT = eventSig('XLPDeposit(address,address,uint256,uint256)');
export const XLP_WITHDRAW = eventSig('XLPWithdraw(address,address,uint256,uint256)');
export const SOURCE_FUNDS_CLAIMED = eventSig('SourceFundsClaimed(bytes32,address,uint256)');
export const TOKEN_SUPPORT_UPDATED = eventSig('TokenSupportUpdated(address,bool)');

// EILRegistry.sol events
export const XLP_REGISTERED = eventSig('XLPRegistered(address,uint256,uint256[])');
export const STAKE_DEPOSITED = eventSig('StakeDeposited(address,uint256,uint256)');
export const UNBONDING_STARTED = eventSig('UnbondingStarted(address,uint256,uint256)');
export const XLP_SLASHED = eventSig('XLPSlashed(address,bytes32,uint256,address)');
export const SLASH_DISPUTED = eventSig('SlashDisputed(bytes32,address)');
export const L2_PAYMASTER_REGISTERED = eventSig('L2PaymasterRegistered(uint256,address)');
export const AUTHORIZED_SLASHER_UPDATED = eventSig('AuthorizedSlasherUpdated(address,bool)');
export const CHAIN_REGISTERED = eventSig('ChainRegistered(address,uint256)');
export const CHAIN_UNREGISTERED = eventSig('ChainUnregistered(address,uint256)');

// ============ OTC Events (OTC.sol) ============

export const OTC_LISTING_CREATED = eventSig('ListingCreated(uint256,address,address,address,uint256,uint256,uint256)');
export const OTC_LISTING_FILLED = eventSig('ListingFilled(uint256,address,uint256)');
export const OTC_LISTING_CANCELLED = eventSig('ListingCancelled(uint256)');
export const OTC_LISTING_UPDATED = eventSig('ListingUpdated(uint256,uint256,uint256)');
export const OTC_SWAP_EXECUTED = eventSig('SwapExecuted(uint256,address,address,uint256,uint256)');

// ============ JEJU Token Events (JejuToken.sol) ============

export const BAN_ENFORCEMENT_TOGGLED = eventSig('BanEnforcementToggled(bool)');
export const BAN_MANAGER_UPDATED = eventSig('BanManagerUpdated(address,address)');
export const FAUCET_CLAIMED = eventSig('FaucetClaimed(address,uint256)');
export const FAUCET_TOGGLED = eventSig('FaucetToggled(bool)');

// ============ Token Factory Events (SimpleERC20Factory.sol) ============

export const TOKEN_CREATED = eventSig('TokenCreated(address,string,string,uint256,uint8)');

// ============ Paymaster Factory Events ============

export const PAYMASTER_DEPLOYED = eventSig('PaymasterDeployed(address,address,address,address,address,uint256,uint256)');
export const TOKEN_REGISTERED = eventSig('TokenRegistered(address,address,string,string,address,uint256,uint256,uint256)');
export const TOKEN_ACTIVATED = eventSig('TokenActivated(address,address)');
export const TOKEN_DEACTIVATED = eventSig('TokenDeactivated(address,address)');

// ============ Event Category Mapping ============

export interface EventCategory {
  signature: string;
  name: string;
  category: 'token' | 'paymaster' | 'cloud' | 'game' | 'marketplace' | 'prediction' | 'registry' | 'node' | 'oracle' | 'defi' | 'moderation' | 'compute' | 'oif' | 'eil';
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
  [GOLD_CLAIMED]: { signature: GOLD_CLAIMED, name: 'GoldClaimed', category: 'game', contract: 'Gold' },
  [GOLD_BURNED]: { signature: GOLD_BURNED, name: 'GoldBurned', category: 'game', contract: 'Gold' },
  [GOLD_SIGNER_UPDATED]: { signature: GOLD_SIGNER_UPDATED, name: 'GameSignerUpdated', category: 'game', contract: 'Gold' },
  [ITEM_MINTED]: { signature: ITEM_MINTED, name: 'ItemMinted', category: 'game', contract: 'Items' },
  [ITEM_BURNED]: { signature: ITEM_BURNED, name: 'ItemBurned', category: 'game', contract: 'Items' },
  [ITEM_TYPE_CREATED]: { signature: ITEM_TYPE_CREATED, name: 'ItemTypeCreated', category: 'game', contract: 'Items' },
  [NFT_PROVENANCE]: { signature: NFT_PROVENANCE, name: 'NFTProvenance', category: 'game', contract: 'Items' },

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
  [STAKE_INCREASED]: { signature: STAKE_INCREASED, name: 'StakeIncreased', category: 'registry', contract: 'IdentityRegistry' },
  [STAKE_WITHDRAWN]: { signature: STAKE_WITHDRAWN, name: 'StakeWithdrawn', category: 'registry', contract: 'IdentityRegistry' },
  [AGENT_BANNED]: { signature: AGENT_BANNED, name: 'AgentBanned', category: 'registry', contract: 'IdentityRegistry' },
  [AGENT_UNBANNED]: { signature: AGENT_UNBANNED, name: 'AgentUnbanned', category: 'registry', contract: 'IdentityRegistry' },
  [AGENT_SLASHED]: { signature: AGENT_SLASHED, name: 'AgentSlashed', category: 'registry', contract: 'IdentityRegistry' },
  [TAGS_UPDATED]: { signature: TAGS_UPDATED, name: 'TagsUpdated', category: 'registry', contract: 'IdentityRegistry' },
  [AGENT_URI_UPDATED]: { signature: AGENT_URI_UPDATED, name: 'AgentUriUpdated', category: 'registry', contract: 'IdentityRegistry' },
  [METADATA_SET]: { signature: METADATA_SET, name: 'MetadataSet', category: 'registry', contract: 'IdentityRegistry' },
  [NEW_FEEDBACK]: { signature: NEW_FEEDBACK, name: 'NewFeedback', category: 'registry', contract: 'ReputationRegistry' },
  [FEEDBACK_REVOKED]: { signature: FEEDBACK_REVOKED, name: 'FeedbackRevoked', category: 'registry', contract: 'ReputationRegistry' },
  [RESPONSE_APPENDED]: { signature: RESPONSE_APPENDED, name: 'ResponseAppended', category: 'registry', contract: 'ReputationRegistry' },
  [VALIDATION_REQUEST]: { signature: VALIDATION_REQUEST, name: 'ValidationRequest', category: 'registry', contract: 'ValidationRegistry' },
  [VALIDATION_RESPONSE]: { signature: VALIDATION_RESPONSE, name: 'ValidationResponse', category: 'registry', contract: 'ValidationRegistry' },
  
  // Moderation events
  [NETWORK_BAN_APPLIED]: { signature: NETWORK_BAN_APPLIED, name: 'NetworkBanApplied', category: 'moderation', contract: 'BanManager' },
  [APP_BAN_APPLIED]: { signature: APP_BAN_APPLIED, name: 'AppBanApplied', category: 'moderation', contract: 'BanManager' },
  [NETWORK_BAN_REMOVED]: { signature: NETWORK_BAN_REMOVED, name: 'NetworkBanRemoved', category: 'moderation', contract: 'BanManager' },
  [APP_BAN_REMOVED]: { signature: APP_BAN_REMOVED, name: 'AppBanRemoved', category: 'moderation', contract: 'BanManager' },
  [REPORT_CREATED]: { signature: REPORT_CREATED, name: 'ReportCreated', category: 'moderation', contract: 'ReportingSystem' },
  [REPORT_RESOLVED]: { signature: REPORT_RESOLVED, name: 'ReportResolved', category: 'moderation', contract: 'ReportingSystem' },
  [CRITICAL_TEMP_BAN]: { signature: CRITICAL_TEMP_BAN, name: 'CriticalTempBan', category: 'moderation', contract: 'ReportingSystem' },
  
  // Node staking events
  [NODE_REGISTERED]: { signature: NODE_REGISTERED, name: 'NodeRegistered', category: 'node', contract: 'NodeStakingManager' },
  [NODE_DEREGISTERED]: { signature: NODE_DEREGISTERED, name: 'NodeDeregistered', category: 'node', contract: 'NodeStakingManager' },
  [PERFORMANCE_UPDATED]: { signature: PERFORMANCE_UPDATED, name: 'PerformanceUpdated', category: 'node', contract: 'NodeStakingManager' },
  [REWARDS_CLAIMED]: { signature: REWARDS_CLAIMED, name: 'RewardsClaimed', category: 'node', contract: 'NodeStakingManager' },
  [NODE_SLASHED]: { signature: NODE_SLASHED, name: 'NodeSlashed', category: 'node', contract: 'NodeStakingManager' },
  
  // Compute events
  [PROVIDER_REGISTERED]: { signature: PROVIDER_REGISTERED, name: 'ProviderRegistered', category: 'compute', contract: 'ComputeRegistry' },
  [PROVIDER_UPDATED]: { signature: PROVIDER_UPDATED, name: 'ProviderUpdated', category: 'compute', contract: 'ComputeRegistry' },
  [PROVIDER_DEACTIVATED]: { signature: PROVIDER_DEACTIVATED, name: 'ProviderDeactivated', category: 'compute', contract: 'ComputeRegistry' },
  [PROVIDER_REACTIVATED]: { signature: PROVIDER_REACTIVATED, name: 'ProviderReactivated', category: 'compute', contract: 'ComputeRegistry' },
  [CAPABILITY_ADDED]: { signature: CAPABILITY_ADDED, name: 'CapabilityAdded', category: 'compute', contract: 'ComputeRegistry' },
  [RENTAL_CREATED]: { signature: RENTAL_CREATED, name: 'RentalCreated', category: 'compute', contract: 'ComputeRental' },
  [RENTAL_STARTED]: { signature: RENTAL_STARTED, name: 'RentalStarted', category: 'compute', contract: 'ComputeRental' },
  [RENTAL_COMPLETED]: { signature: RENTAL_COMPLETED, name: 'RentalCompleted', category: 'compute', contract: 'ComputeRental' },
  [RENTAL_CANCELLED]: { signature: RENTAL_CANCELLED, name: 'RentalCancelled', category: 'compute', contract: 'ComputeRental' },
  [SETTLED]: { signature: SETTLED, name: 'Settled', category: 'compute', contract: 'InferenceServing' },
  [AGENT_SETTLED]: { signature: AGENT_SETTLED, name: 'AgentSettled', category: 'compute', contract: 'InferenceServing' },
  
  // OIF events
  [ORDER_CREATED]: { signature: ORDER_CREATED, name: 'OrderCreated', category: 'oif', contract: 'InputSettler' },
  [ORDER_CLAIMED]: { signature: ORDER_CLAIMED, name: 'OrderClaimed', category: 'oif', contract: 'InputSettler' },
  [ORDER_SETTLED]: { signature: ORDER_SETTLED, name: 'OrderSettled', category: 'oif', contract: 'InputSettler' },
  [ORDER_REFUNDED]: { signature: ORDER_REFUNDED, name: 'OrderRefunded', category: 'oif', contract: 'InputSettler' },
  [ORDER_FILLED]: { signature: ORDER_FILLED, name: 'OrderFilled', category: 'oif', contract: 'OutputSettler' },
  [LIQUIDITY_DEPOSITED]: { signature: LIQUIDITY_DEPOSITED, name: 'LiquidityDeposited', category: 'oif', contract: 'OutputSettler' },
  [LIQUIDITY_WITHDRAWN]: { signature: LIQUIDITY_WITHDRAWN, name: 'LiquidityWithdrawn', category: 'oif', contract: 'OutputSettler' },
  [SOLVER_REGISTERED]: { signature: SOLVER_REGISTERED, name: 'SolverRegistered', category: 'oif', contract: 'SolverRegistry' },
  [SOLVER_SLASHED]: { signature: SOLVER_SLASHED, name: 'SolverSlashed', category: 'oif', contract: 'SolverRegistry' },
  [ATTESTATION_SUBMITTED]: { signature: ATTESTATION_SUBMITTED, name: 'AttestationSubmitted', category: 'oif', contract: 'HyperlaneOracle' },
  
  // EIL events
  [VOUCHER_REQUESTED]: { signature: VOUCHER_REQUESTED, name: 'VoucherRequested', category: 'eil', contract: 'EILVault' },
  [VOUCHER_ISSUED]: { signature: VOUCHER_ISSUED, name: 'VoucherIssued', category: 'eil', contract: 'EILVault' },
  [VOUCHER_FULFILLED]: { signature: VOUCHER_FULFILLED, name: 'VoucherFulfilled', category: 'eil', contract: 'EILVault' },
  [XLP_REGISTERED]: { signature: XLP_REGISTERED, name: 'XLPRegistered', category: 'eil', contract: 'EILRegistry' },
  [XLP_SLASHED]: { signature: XLP_SLASHED, name: 'XLPSlashed', category: 'eil', contract: 'EILRegistry' },
  
  // OTC events
  [OTC_LISTING_CREATED]: { signature: OTC_LISTING_CREATED, name: 'ListingCreated', category: 'defi', contract: 'OTC' },
  [OTC_LISTING_FILLED]: { signature: OTC_LISTING_FILLED, name: 'ListingFilled', category: 'defi', contract: 'OTC' },
  [OTC_SWAP_EXECUTED]: { signature: OTC_SWAP_EXECUTED, name: 'SwapExecuted', category: 'defi', contract: 'OTC' },
  
  // Factory events
  [PAYMASTER_DEPLOYED]: { signature: PAYMASTER_DEPLOYED, name: 'PaymasterDeployed', category: 'paymaster', contract: 'PaymasterFactory' },
  [TOKEN_REGISTERED]: { signature: TOKEN_REGISTERED, name: 'TokenRegistered', category: 'paymaster', contract: 'TokenRegistry' },
  [TOKEN_CREATED]: { signature: TOKEN_CREATED, name: 'TokenCreated', category: 'token', contract: 'SimpleERC20Factory' },

  // JEJU Token events
  [BAN_ENFORCEMENT_TOGGLED]: { signature: BAN_ENFORCEMENT_TOGGLED, name: 'BanEnforcementToggled', category: 'token', contract: 'JejuToken' },
  [BAN_MANAGER_UPDATED]: { signature: BAN_MANAGER_UPDATED, name: 'BanManagerUpdated', category: 'token', contract: 'JejuToken' },
  [FAUCET_CLAIMED]: { signature: FAUCET_CLAIMED, name: 'FaucetClaimed', category: 'token', contract: 'JejuToken' },
  [FAUCET_TOGGLED]: { signature: FAUCET_TOGGLED, name: 'FaucetToggled', category: 'token', contract: 'JejuToken' },
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
  TRANSACTION_SPONSORED, FEES_DISTRIBUTED, APP_CLAIMED, ETH_ADDED, ETH_REMOVED, 
  FEES_CLAIMED, ENTRY_POINT_FUNDED, PAYMASTER_DEPLOYED,
];

export const GAME_EVENTS = [
  PLAYER_REGISTERED, PLAYER_MOVED, PLAYER_DIED, LEVEL_UP, XP_GAINED,
  MOB_KILLED, GOLD_CLAIMED, ITEM_MINTED, ITEM_EQUIPPED, ITEM_ADDED,
];

export const MARKETPLACE_EVENTS = [
  LISTING_CREATED, LISTING_SOLD, LISTING_CANCELLED, TRADE_CREATED, TRADE_EXECUTED, TRADE_CANCELLED,
];

export const PREDICTION_EVENTS = [
  MARKET_CREATED, SHARES_PURCHASED, SHARES_SOLD, MARKET_RESOLVED, GAME_COMMITTED, GAME_REVEALED, PAYOUT_CLAIMED,
];

export const CLOUD_EVENTS = [
  SERVICE_REGISTERED, SERVICE_USAGE_RECORDED, CREDIT_DEPOSITED, CREDIT_DEDUCTED, CREDITS_PURCHASED,
];

export const COMPUTE_EVENTS = [
  PROVIDER_REGISTERED, PROVIDER_UPDATED, PROVIDER_DEACTIVATED, PROVIDER_REACTIVATED,
  STAKE_ADDED, STAKE_WITHDRAWN_COMPUTE, CAPABILITY_ADDED, CAPABILITY_UPDATED,
  RENTAL_CREATED, RENTAL_STARTED, RENTAL_COMPLETED, RENTAL_CANCELLED, RENTAL_EXTENDED, RENTAL_RATED,
  USER_BANNED, USER_UNBANNED, PROVIDER_BANNED, DISPUTE_CREATED, DISPUTE_RESOLVED,
  SERVICE_REGISTERED_INFERENCE, SERVICE_DEACTIVATED, SETTLED, AGENT_SETTLED,
  STAKED_AS_USER, STAKED_AS_PROVIDER, STAKED_AS_GUARDIAN, UNSTAKED, SLASHED,
];

export const OIF_EVENTS = [
  ORDER_CREATED, ORDER_CLAIMED, ORDER_SETTLED, ORDER_REFUNDED, ORACLE_UPDATED,
  LIQUIDITY_DEPOSITED, LIQUIDITY_WITHDRAWN, ORDER_FILLED,
  SOLVER_REGISTERED, SOLVER_STAKE_DEPOSITED, SOLVER_SLASHED, SOLVER_WITHDRAWN, FILL_RECORDED, CHAIN_ADDED, CHAIN_REMOVED,
  ATTESTATION_SUBMITTED, ATTESTER_UPDATED,
];

export const EIL_EVENTS = [
  VOUCHER_REQUESTED, VOUCHER_ISSUED, VOUCHER_FULFILLED, VOUCHER_EXPIRED, FUNDS_REFUNDED,
  XLP_DEPOSIT, XLP_WITHDRAW, SOURCE_FUNDS_CLAIMED, TOKEN_SUPPORT_UPDATED,
  XLP_REGISTERED, STAKE_DEPOSITED, UNBONDING_STARTED, XLP_SLASHED, SLASH_DISPUTED,
  L2_PAYMASTER_REGISTERED, AUTHORIZED_SLASHER_UPDATED, CHAIN_REGISTERED, CHAIN_UNREGISTERED,
];

export const OTC_EVENTS = [
  OTC_LISTING_CREATED, OTC_LISTING_FILLED, OTC_LISTING_CANCELLED, OTC_LISTING_UPDATED, OTC_SWAP_EXECUTED,
];

export const REGISTRY_EVENTS = [
  AGENT_REGISTERED, STAKE_INCREASED, STAKE_WITHDRAWN, AGENT_BANNED, AGENT_UNBANNED, AGENT_SLASHED,
  TAGS_UPDATED, AGENT_URI_UPDATED, METADATA_SET, GOVERNANCE_UPDATED, REPUTATION_ORACLE_UPDATED,
  STAKE_TOKEN_ADDED, STAKE_TOKEN_REMOVED,
  NEW_FEEDBACK, FEEDBACK_REVOKED, RESPONSE_APPENDED,
  VALIDATION_REQUEST, VALIDATION_RESPONSE,
];

export const BAN_EVENTS = [
  NETWORK_BAN_APPLIED, APP_BAN_APPLIED, NETWORK_BAN_REMOVED, APP_BAN_REMOVED,
];

export const REPORTING_EVENTS = [
  REPORT_CREATED, REPORT_RESOLVED, REPORT_EXECUTED, REPORTER_REWARDED, REPORTER_SLASHED, CRITICAL_TEMP_BAN,
];

export const NODE_EVENTS = [
  NODE_REGISTERED, NODE_DEREGISTERED, PERFORMANCE_UPDATED, REWARDS_CLAIMED, NODE_SLASHED, PAYMASTER_FEE_DISTRIBUTED,
];

export const ORACLE_EVENTS = [
  FEED_POST_PUBLISHED, MARKET_UPDATED, SKILL_LEVEL_UP, PRICES_UPDATED,
];

export const JEJU_TOKEN_EVENTS = [
  BAN_ENFORCEMENT_TOGGLED, BAN_MANAGER_UPDATED, FAUCET_CLAIMED, FAUCET_TOGGLED,
];

// ============ All Known Events ============

export const ALL_KNOWN_EVENTS = [
  ...PAYMASTER_EVENTS,
  ...GAME_EVENTS,
  ...MARKETPLACE_EVENTS,
  ...PREDICTION_EVENTS,
  ...CLOUD_EVENTS,
  ...COMPUTE_EVENTS,
  ...OIF_EVENTS,
  ...EIL_EVENTS,
  ...OTC_EVENTS,
  ...REGISTRY_EVENTS,
  ...BAN_EVENTS,
  ...REPORTING_EVENTS,
  ...NODE_EVENTS,
  ...ORACLE_EVENTS,
  ...JEJU_TOKEN_EVENTS,
];

// ============ Contract Address Mapping (filled at runtime) ============

export interface ContractInfo {
  address: string;
  name: string;
  type: 'paymaster' | 'cloud' | 'game' | 'marketplace' | 'prediction' | 'registry' | 'node' | 'oracle' | 'token' | 'defi' | 'moderation' | 'compute' | 'oif' | 'eil';
  events: string[];
}

export const CONTRACT_REGISTRY: Map<string, ContractInfo> = new Map();

export function registerContract(info: ContractInfo) {
  CONTRACT_REGISTRY.set(info.address.toLowerCase(), info);
}

export function getContractInfo(address: string): ContractInfo | undefined {
  return CONTRACT_REGISTRY.get(address.toLowerCase());
}

// ============ Event Name Mapping ============

export function getEventName(topic0: string): string {
  const category = EVENT_REGISTRY[topic0];
  return category?.name || 'Unknown';
}
