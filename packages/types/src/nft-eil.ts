/**
 * @fileoverview NFT Ethereum Interop Layer (NFT-EIL) Types
 *
 * Cross-chain NFT transfer types for:
 * - ERC-721 (unique NFTs)
 * - ERC-1155 (semi-fungible tokens)
 * - Metadata preservation
 * - Royalty enforcement
 * - Provenance tracking
 *
 * @see INFTEIL.sol for contract interfaces
 */

import { z } from 'zod';
import { AddressSchema } from './validation';
import { SupportedChainIdSchema } from './eil';
export { SupportedChainIdSchema };

// ============ Asset Types ============

export const NFTAssetTypeSchema = z.enum(['ERC721', 'ERC1155']);
export type NFTAssetType = z.infer<typeof NFTAssetTypeSchema>;

// ============ NFT Voucher Request ============

export const NFTVoucherStatusSchema = z.enum([
  'pending', // Request created, waiting for XLP
  'claimed', // XLP issued voucher
  'fulfilled', // Transfer complete on destination
  'expired', // No XLP responded in time
  'failed', // XLP failed to fulfill
  'refunded', // User refunded after expiry
]);
export type NFTVoucherStatus = z.infer<typeof NFTVoucherStatusSchema>;

export const NFTVoucherRequestSchema = z.object({
  requestId: z.string(), // bytes32
  requester: AddressSchema,
  assetType: NFTAssetTypeSchema,
  sourceChain: SupportedChainIdSchema,
  destinationChain: SupportedChainIdSchema,
  collection: AddressSchema,
  tokenId: z.string(), // uint256 as string
  amount: z.string(), // 1 for ERC721, >1 for ERC1155
  recipient: AddressSchema,
  gasOnDestination: z.string(),
  maxFee: z.string(),
  currentFee: z.string(),
  feeIncrement: z.string(),
  metadataHash: z.string(), // bytes32 hash of tokenURI
  deadline: z.number(), // Block number
  createdAt: z.number(), // Unix timestamp
  createdBlock: z.number(),
  status: NFTVoucherStatusSchema,
  // Competition
  bidCount: z.number().optional(),
  winningXLP: AddressSchema.optional(),
  winningFee: z.string().optional(),
});
export type NFTVoucherRequest = z.infer<typeof NFTVoucherRequestSchema>;

// ============ NFT Voucher ============

export const NFTVoucherSchema = z.object({
  voucherId: z.string(), // bytes32
  requestId: z.string(),
  xlp: AddressSchema,
  assetType: NFTAssetTypeSchema,
  sourceChainId: SupportedChainIdSchema,
  destinationChainId: SupportedChainIdSchema,
  sourceCollection: AddressSchema,
  destinationCollection: AddressSchema, // Wrapped collection
  tokenId: z.string(),
  amount: z.string(),
  fee: z.string(),
  gasProvided: z.string(),
  signature: z.string(),
  issuedAt: z.number(),
  issuedBlock: z.number(),
  expiresAt: z.number(),
  status: NFTVoucherStatusSchema,
  // Transactions
  sourceClaimTx: z.string().optional(),
  destinationFulfillTx: z.string().optional(),
});
export type NFTVoucher = z.infer<typeof NFTVoucherSchema>;

// ============ Wrapped NFT Info ============

export const WrappedNFTInfoSchema = z.object({
  wrappedTokenId: z.string(),
  wrappedCollection: AddressSchema,
  homeChainId: SupportedChainIdSchema,
  originalCollection: AddressSchema,
  originalTokenId: z.string(),
  tokenURI: z.string(),
  metadataHash: z.string(),
  bridgedAt: z.number(),
  bridgedBy: AddressSchema,
  // Optional additional metadata
  name: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  attributes: z.array(z.record(z.string(), z.string())).optional(),
});
export type WrappedNFTInfo = z.infer<typeof WrappedNFTInfoSchema>;

// ============ Provenance Entry ============

export const ProvenanceEntrySchema = z.object({
  chainId: SupportedChainIdSchema,
  collection: AddressSchema,
  tokenId: z.string(),
  timestamp: z.number(),
  txHash: z.string(),
  owner: AddressSchema,
  // Event type
  eventType: z.enum(['mint', 'transfer', 'bridge_out', 'bridge_in', 'wrap', 'unwrap']).optional(),
});
export type ProvenanceEntry = z.infer<typeof ProvenanceEntrySchema>;

// ============ Cross-Chain NFT Transfer ============

export const CrossChainNFTTransferSchema = z.object({
  id: z.string(),
  user: AddressSchema,
  assetType: NFTAssetTypeSchema,
  sourceChainId: SupportedChainIdSchema,
  destinationChainId: SupportedChainIdSchema,
  collection: AddressSchema,
  tokenId: z.string(),
  amount: z.string(),
  recipient: AddressSchema,
  // Transfer mode
  mode: z.enum(['hyperlane', 'xlp', 'intent']),
  // Status
  status: z.enum(['pending', 'in_transit', 'completed', 'failed', 'refunded']),
  // Timing
  createdAt: z.number(),
  completedAt: z.number().optional(),
  // Transaction hashes
  sourceTxHash: z.string().optional(),
  destinationTxHash: z.string().optional(),
  // Hyperlane specific
  messageId: z.string().optional(),
  // XLP specific
  voucherId: z.string().optional(),
  xlp: AddressSchema.optional(),
  fee: z.string().optional(),
  // Intent specific
  orderId: z.string().optional(),
  solver: AddressSchema.optional(),
});
export type CrossChainNFTTransfer = z.infer<typeof CrossChainNFTTransferSchema>;

// ============ NFT Collection Info ============

export const NFTCollectionInfoSchema = z.object({
  address: AddressSchema,
  chainId: SupportedChainIdSchema,
  name: z.string(),
  symbol: z.string(),
  assetType: NFTAssetTypeSchema,
  // Cross-chain info
  isHomeChain: z.boolean(),
  homeChainId: SupportedChainIdSchema.optional(),
  originalCollection: AddressSchema.optional(),
  // Royalty
  royaltyReceiver: AddressSchema.optional(),
  royaltyBps: z.number().optional(),
  // Stats
  totalSupply: z.string().optional(),
  totalBridgedOut: z.number().optional(),
  totalBridgedIn: z.number().optional(),
});
export type NFTCollectionInfo = z.infer<typeof NFTCollectionInfoSchema>;

// ============ XLP NFT Liquidity ============

export const XLPNFTLiquiditySchema = z.object({
  xlp: AddressSchema,
  // Wrapped collections deployed by this XLP
  wrappedCollections: z.array(
    z.object({
      sourceChainId: SupportedChainIdSchema,
      sourceCollection: AddressSchema,
      wrappedCollection: AddressSchema,
      deployedAt: z.number(),
    })
  ),
  // Stats
  totalNFTsBridged: z.number(),
  totalFeesEarned: z.string(),
  successRate: z.number(),
  avgResponseTimeMs: z.number(),
});
export type XLPNFTLiquidity = z.infer<typeof XLPNFTLiquiditySchema>;

// ============ NFT Bridge Quote ============

export const NFTBridgeQuoteSchema = z.object({
  quoteId: z.string(),
  // Input
  sourceChainId: SupportedChainIdSchema,
  destinationChainId: SupportedChainIdSchema,
  collection: AddressSchema,
  tokenId: z.string(),
  amount: z.string(),
  // Output
  wrappedCollection: AddressSchema,
  // Pricing
  fee: z.string(),
  gasPayment: z.string(),
  totalCost: z.string(),
  // Timing
  estimatedTimeSeconds: z.number(),
  validUntil: z.number(),
  // Route info
  route: z.enum(['hyperlane', 'xlp', 'intent']),
  xlp: AddressSchema.optional(),
  solver: AddressSchema.optional(),
});
export type NFTBridgeQuote = z.infer<typeof NFTBridgeQuoteSchema>;

// ============ NFT Intent Order ============

export const NFTIntentOrderSchema = z.object({
  orderId: z.string(),
  user: AddressSchema,
  nonce: z.string(),
  sourceChainId: SupportedChainIdSchema,
  openDeadline: z.number(),
  fillDeadline: z.number(),
  // NFT details
  assetType: NFTAssetTypeSchema,
  collection: AddressSchema,
  tokenId: z.string(),
  amount: z.string(),
  destinationChainId: SupportedChainIdSchema,
  recipient: AddressSchema,
  metadataHash: z.string(),
  // Status
  status: z.enum(['open', 'claimed', 'filled', 'expired', 'refunded']),
  solver: AddressSchema.optional(),
  // Transactions
  openTx: z.string().optional(),
  fillTx: z.string().optional(),
  settleTx: z.string().optional(),
});
export type NFTIntentOrder = z.infer<typeof NFTIntentOrderSchema>;

// ============ Event Types ============

export const NFTEILEventTypeSchema = z.enum([
  // Voucher events
  'NFTVoucherRequested',
  'NFTVoucherIssued',
  'NFTVoucherFulfilled',
  'NFTVoucherExpired',
  'NFTRefunded',
  'SourceNFTClaimed',
  // Bridge events
  'NFTBridgeInitiated',
  'NFTBridgeReceived',
  // Wrapped events
  'NFTWrapped',
  'NFTUnwrapped',
  // Provenance
  'ProvenanceRecorded',
  // Intent events
  'NFTOrderCreated',
  'NFTOrderClaimed',
  'NFTOrderSettled',
  'NFTOrderRefunded',
]);
export type NFTEILEventType = z.infer<typeof NFTEILEventTypeSchema>;

/**
 * Strongly typed event data for NFT EIL events
 */
export const NFTVoucherEventDataSchema = z.object({
  requestId: z.string().optional(),
  voucherId: z.string().optional(),
  collection: AddressSchema.optional(),
  tokenId: z.string().optional(),
  amount: z.string().optional(),
  xlp: AddressSchema.optional(),
  user: AddressSchema.optional(),
  recipient: AddressSchema.optional(),
  fee: z.string().optional(),
});

export const NFTBridgeEventDataSchema = z.object({
  transferId: z.string().optional(),
  collection: AddressSchema.optional(),
  tokenId: z.string().optional(),
  sourceChainId: SupportedChainIdSchema.optional(),
  destinationChainId: SupportedChainIdSchema.optional(),
  sender: AddressSchema.optional(),
  recipient: AddressSchema.optional(),
});

export const NFTOrderEventDataSchema = z.object({
  orderId: z.string().optional(),
  user: AddressSchema.optional(),
  solver: AddressSchema.optional(),
  collection: AddressSchema.optional(),
  tokenId: z.string().optional(),
});

/**
 * Union of all NFT EIL event data types
 */
export const NFTEILEventDataSchema = z.union([
  NFTVoucherEventDataSchema,
  NFTBridgeEventDataSchema,
  NFTOrderEventDataSchema,
]);
export type NFTEILEventData = z.infer<typeof NFTEILEventDataSchema>;

export const NFTEILEventSchema = z.object({
  id: z.string(),
  type: NFTEILEventTypeSchema,
  chainId: SupportedChainIdSchema,
  blockNumber: z.number(),
  transactionHash: z.string(),
  logIndex: z.number(),
  timestamp: z.number(),
  /** Strongly typed event data */
  data: NFTEILEventDataSchema,
});
export type NFTEILEvent = z.infer<typeof NFTEILEventSchema>;

// ============ Configuration ============

export const NFTEILConfigSchema = z.object({
  // NFT Paymaster addresses per chain
  nftPaymasters: z.record(z.string(), AddressSchema),
  // Wrapped NFT contracts per chain
  wrappedNFT: z.record(z.string(), AddressSchema),
  // NFT Input Settler addresses per chain
  nftInputSettlers: z.record(z.string(), AddressSchema),
  // Supported collections
  supportedCollections: z.record(z.string(), z.array(AddressSchema)),
  // Timing
  requestTimeout: z.number(),
  voucherTimeout: z.number(),
  claimDelay: z.number(),
  // Fees
  minFee: z.string(),
  maxFee: z.string(),
});
export type NFTEILConfig = z.infer<typeof NFTEILConfigSchema>;

// ============ Analytics ============

export const NFTEILStatsSchema = z.object({
  totalNFTsBridged: z.number(),
  totalUniqueCollections: z.number(),
  totalTransfers: z.number(),
  totalFeesCollected: z.string(),
  // By asset type
  erc721Bridged: z.number(),
  erc1155Bridged: z.number(),
  // By route
  hyperlaneBridges: z.number(),
  xlpBridges: z.number(),
  intentBridges: z.number(),
  // Performance
  avgBridgeTimeSeconds: z.number(),
  successRate: z.number(),
  // Recent
  last24hTransfers: z.number(),
  last24hFees: z.string(),
  lastUpdated: z.number(),
});
export type NFTEILStats = z.infer<typeof NFTEILStatsSchema>;

// ============ SDK Types ============

export const NFTBridgeModeSchema = z.enum(['hyperlane', 'xlp', 'intent']);
export type NFTBridgeMode = z.infer<typeof NFTBridgeModeSchema>;

export const CrossChainNFTParamsSchema = z.object({
  assetType: NFTAssetTypeSchema,
  collection: AddressSchema,
  tokenId: z.bigint(),
  amount: z.bigint(),
  destinationChainId: z.number().int().positive(),
  recipient: AddressSchema.optional(),
  mode: NFTBridgeModeSchema,
  maxFee: z.bigint().optional(),
});
export type CrossChainNFTParams = z.infer<typeof CrossChainNFTParamsSchema>;

export const NFTBridgeResultSchema = z.object({
  txHash: z.string(),
  requestId: z.string().optional(),
  messageId: z.string().optional(),
  orderId: z.string().optional(),
  estimatedArrival: z.number(),
});
export type NFTBridgeResult = z.infer<typeof NFTBridgeResultSchema>;

export const WrappedNFTDetailsSchema = z.object({
  isWrapped: z.boolean(),
  homeChainId: z.number().int().positive().optional(),
  originalCollection: AddressSchema.optional(),
  originalTokenId: z.bigint().optional(),
  tokenURI: z.string().optional(),
  provenance: z.array(ProvenanceEntrySchema),
});
export type WrappedNFTDetails = z.infer<typeof WrappedNFTDetailsSchema>;
