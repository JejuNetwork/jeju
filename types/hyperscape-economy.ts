/**
 * @fileoverview Hyperscape Economy Types
 * @module types/hyperscape-economy
 * 
 * Type definitions for Hyperscape on-chain economy contracts and systems.
 */

import type { Address, Hash } from 'viem';

// ============ HyperscapeGold Types ============

export interface HyperscapeGoldConfig {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  maxSupply: bigint;
  gameSigner: Address;
}

export interface GoldClaimRequest {
  player: Address;
  amount: bigint;
  nonce: number;
}

export interface GoldClaimSignature {
  player: Address;
  amount: string;
  nonce: number;
  signature: Hash;
}

// ============ HyperscapeItems Types ============

export interface HyperscapeItemsConfig {
  address: Address;
  name: string;
  symbol: string;
  gameSigner: Address;
}

export interface ItemMetadata {
  itemId: string;
  instanceId: Hash;
  attack: number;
  defense: number;
  strength: number;
  rarity: ItemRarity;
  mintedAt: number;
}

export enum ItemRarity {
  COMMON = 0,
  UNCOMMON = 1,
  RARE = 2,
  EPIC = 3,
  LEGENDARY = 4
}

export interface ItemMintRequest {
  player: Address;
  itemId: string;
  instanceId: Hash;
  attack: number;
  defense: number;
  strength: number;
  rarity: ItemRarity;
  tokenURI: string;
}

export interface ItemMintSignature {
  player: Address;
  itemId: string;
  instanceId: Hash;
  attack: number;
  defense: number;
  strength: number;
  rarity: ItemRarity;
  signature: Hash;
}

// ============ PlayerTradeEscrow Types ============

export interface PlayerTradeEscrowConfig {
  address: Address;
  tradeExpiration: number;
  minReviewTime: number;
}

export interface Trade {
  tradeId: bigint;
  playerA: Address;
  playerB: Address;
  playerADeposited: boolean;
  playerBDeposited: boolean;
  playerAConfirmed: boolean;
  playerBConfirmed: boolean;
  executed: boolean;
  cancelled: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface TradeItem {
  tokenContract: Address;
  tokenId: bigint;
  amount: bigint; // 0 for ERC-721, > 0 for ERC-20
  isERC20: boolean;
}

export enum TradeStatus {
  PENDING = 'pending',
  DEPOSITED = 'deposited',
  CONFIRMED = 'confirmed',
  EXECUTED = 'executed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired'
}

// ============ JejuBazaar Types ============

export interface JejuBazaarConfig {
  address: Address;
  hyperscapeGold: Address;
  usdc: Address;
  feeRecipient: Address;
  platformFeeBps: number;
}

export enum MarketplaceCurrency {
  ETH = 0,
  HG = 1,
  USDC = 2
}

export enum ListingType {
  DIRECT = 0,
  AUCTION = 1
}

export enum ListingStatus {
  ACTIVE = 0,
  SOLD = 1,
  CANCELLED = 2
}

export interface MarketplaceListing {
  listingId: bigint;
  seller: Address;
  nftContract: Address;
  tokenId: bigint;
  currency: MarketplaceCurrency;
  price: bigint;
  listingType: ListingType;
  status: ListingStatus;
  createdAt: number;
  expiresAt: number;
}

export interface CreateListingParams {
  nftContract: Address;
  tokenId: bigint;
  currency: MarketplaceCurrency;
  price: bigint;
  duration: number; // seconds, 0 = no expiration
}

export interface BuyListingParams {
  listingId: bigint;
  paymentToken?: Address; // For paymaster integration
}

// ============ Game Integration Types ============

export interface UnclaimedGold {
  player: Address;
  amount: bigint;
  earnedAt: number;
}

export interface ClaimedGold {
  player: Address;
  amount: bigint;
  claimedAt: number;
  txHash: Hash;
}

export interface ItemInstance {
  instanceId: Hash;
  itemId: string;
  owner: Address | null; // null if on ground
  isMinted: boolean;
  mintedTokenId: bigint | null;
  createdAt: number;
  location: {
    x: number;
    y: number;
    z: number;
  } | null;
}

export interface PendingTrade {
  tradeId: bigint;
  initiator: Address;
  target: Address;
  status: TradeStatus;
  items: TradeItem[];
  createdAt: number;
}

// ============ Paymaster Integration Types ============

export interface PaymasterTokenInfo {
  token: Address;
  name: string;
  symbol: string;
  decimals: number;
  isActive: boolean;
  minFeeMargin: number;
  maxFeeMargin: number;
  balance: bigint; // User's balance
  estimatedGasCost: bigint; // In this token
}

export interface PaymasterOption {
  token: PaymasterTokenInfo;
  paymaster: Address;
  available: boolean;
  reason?: string; // If not available
}

// ============ Indexer Types ============

export interface HyperscapeNFT {
  tokenId: bigint;
  contract: Address;
  owner: Address;
  metadata: ItemMetadata;
  tokenURI: string;
  mintedAt: number;
  lastTransferAt: number;
  listing: MarketplaceListing | null;
}

export interface HyperscapeGoldBalance {
  owner: Address;
  balance: bigint;
  unclaimed: bigint;
  claimed: bigint;
  lastUpdate: number;
}

export interface TradeEvent {
  tradeId: bigint;
  type: 'created' | 'deposited' | 'confirmed' | 'executed' | 'cancelled';
  player: Address;
  timestamp: number;
  txHash: Hash;
}

export interface MarketplaceEvent {
  listingId: bigint;
  type: 'created' | 'sold' | 'cancelled';
  actor: Address;
  timestamp: number;
  txHash: Hash;
  price?: bigint;
  currency?: MarketplaceCurrency;
}

// ============ Contract ABI Types ============

export interface HyperscapeGoldContract {
  address: Address;
  abi: readonly unknown[];
  read: {
    nonces: (player: Address) => Promise<bigint>;
    getNonce: (player: Address) => Promise<bigint>;
    verifyClaim: (
      player: Address,
      amount: bigint,
      nonce: bigint,
      signature: Hash
    ) => Promise<boolean>;
    balanceOf: (address: Address) => Promise<bigint>;
    totalSupply: () => Promise<bigint>;
    MAX_SUPPLY: () => Promise<bigint>;
    gameSigner: () => Promise<Address>;
  };
  write: {
    claimGold: (amount: bigint, nonce: bigint, signature: Hash) => Promise<Hash>;
  };
}

export interface HyperscapeItemsContract {
  address: Address;
  abi: readonly unknown[];
  read: {
    ownerOf: (tokenId: bigint) => Promise<Address>;
    getItemMetadata: (tokenId: bigint) => Promise<ItemMetadata>;
    checkInstance: (instanceId: Hash) => Promise<{ minted: boolean; tokenId: bigint }>;
    verifyMint: (
      player: Address,
      itemId: string,
      instanceId: Hash,
      attack: number,
      defense: number,
      strength: number,
      rarity: number,
      signature: Hash
    ) => Promise<boolean>;
    totalSupply: () => Promise<bigint>;
    tokenURI: (tokenId: bigint) => Promise<string>;
  };
  write: {
    mintItem: (
      itemId: string,
      instanceId: Hash,
      attack: number,
      defense: number,
      strength: number,
      rarity: number,
      tokenURI: string,
      signature: Hash
    ) => Promise<Hash>;
    burnItem: (tokenId: bigint) => Promise<Hash>;
  };
}

export interface PlayerTradeEscrowContract {
  address: Address;
  abi: readonly unknown[];
  read: {
    trades: (tradeId: bigint) => Promise<Trade>;
    getTradeItems: (tradeId: bigint) => Promise<{ itemsA: TradeItem[]; itemsB: TradeItem[] }>;
    approvedContracts: (contract: Address) => Promise<boolean>;
  };
  write: {
    createTrade: (playerB: Address) => Promise<bigint>;
    depositItems: (tradeId: bigint, items: TradeItem[]) => Promise<Hash>;
    confirmTrade: (tradeId: bigint) => Promise<Hash>;
    cancelTrade: (tradeId: bigint) => Promise<Hash>;
  };
}

export interface JejuBazaarContract {
  address: Address;
  abi: readonly unknown[];
  read: {
    listings: (listingId: bigint) => Promise<MarketplaceListing>;
    getListing: (listingId: bigint) => Promise<MarketplaceListing>;
    getTokenListing: (nftContract: Address, tokenId: bigint) => Promise<bigint>;
    platformFeeBps: () => Promise<bigint>;
  };
  write: {
    createListing: (
      nftContract: Address,
      tokenId: bigint,
      currency: MarketplaceCurrency,
      price: bigint,
      duration: number
    ) => Promise<bigint>;
    buyListing: (listingId: bigint) => Promise<Hash>;
    cancelListing: (listingId: bigint) => Promise<Hash>;
  };
}

// ============ UI State Types ============

export interface GoldUIState {
  unclaimed: bigint;
  claimed: bigint;
  total: bigint;
  isClaiming: boolean;
  claimError: string | null;
}

export interface ItemUIState {
  inventory: ItemInstance[];
  equipped: ItemInstance[];
  minting: Hash | null;
  mintError: string | null;
}

export interface TradeUIState {
  activeTrade: PendingTrade | null;
  yourItems: TradeItem[];
  theirItems: TradeItem[];
  status: TradeStatus;
  canConfirm: boolean;
  error: string | null;
}

export interface MarketplaceUIState {
  listings: HyperscapeNFT[];
  selectedListing: MarketplaceListing | null;
  filters: {
    currency: MarketplaceCurrency | 'all';
    minPrice: bigint;
    maxPrice: bigint;
    rarity: ItemRarity | 'all';
    sortBy: 'price' | 'recent' | 'rarity';
  };
  isLoading: boolean;
  error: string | null;
}

