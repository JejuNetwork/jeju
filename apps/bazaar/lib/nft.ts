/**
 * NFT business logic utilities
 *
 * Extracted from hooks and pages for testability and reuse.
 */

import {
  AddressSchema,
  BigIntSchema,
  NonEmptyStringSchema,
} from '@jejunetwork/types'
import { formatEther, parseEther } from 'viem'
import { z } from 'zod'
import type { NormalizedNFT } from '../schemas/nft'

// ============================================================================
// Schemas
// ============================================================================

export const ListingParamsSchema = z.object({
  nftContract: AddressSchema,
  tokenId: BigIntSchema,
  priceETH: NonEmptyStringSchema,
  durationDays: z.number().int().positive('Duration must be positive'),
})

export type ListingParams = z.infer<typeof ListingParamsSchema>

export const AuctionParamsSchema = z.object({
  nftContract: AddressSchema,
  tokenId: BigIntSchema,
  reservePriceETH: NonEmptyStringSchema,
  durationDays: z.number().int().positive('Duration must be positive'),
  buyoutPriceETH: NonEmptyStringSchema.optional(),
})

export type AuctionParams = z.infer<typeof AuctionParamsSchema>

export const BidParamsSchema = z.object({
  auctionId: BigIntSchema,
  bidAmountETH: NonEmptyStringSchema,
})

export type BidParams = z.infer<typeof BidParamsSchema>

export const OfferParamsSchema = z.object({
  nftContract: AddressSchema,
  tokenId: BigIntSchema,
  offerPriceETH: NonEmptyStringSchema,
})

export type OfferParams = z.infer<typeof OfferParamsSchema>

// ============================================================================
// Constants
// ============================================================================

export const MIN_LISTING_PRICE_ETH = 0.001
export const MIN_BID_INCREMENT_BPS = 500 // 5%
export const DEFAULT_AUCTION_DURATION_SECONDS = 86400 // 1 day

// ============================================================================
// Normalization
// ============================================================================

export interface ERC721TokenInput {
  id: string
  tokenId: string
  owner?: { address: string }
  contract?: { address: string; name: string }
  metadata?: string
}

export interface ERC1155BalanceInput {
  id: string
  tokenId: string
  balance: string
  contract?: { address: string; name: string }
}

/**
 * Cast a string to Address type (0x prefixed)
 */
function toAddress(addr: string | undefined): `0x${string}` | undefined {
  if (!addr) return undefined
  return addr as `0x${string}`
}

/**
 * Normalize an ERC721 token into a common NFT format
 */
export function normalizeERC721Token(token: ERC721TokenInput): NormalizedNFT {
  return {
    id: token.id,
    tokenId: token.tokenId,
    owner: toAddress(token.owner?.address),
    contract: toAddress(token.contract?.address),
    contractName: token.contract?.name ?? 'Unknown',
    type: 'ERC721',
    metadata: token.metadata,
  }
}

/**
 * Normalize an ERC1155 balance into a common NFT format
 */
export function normalizeERC1155Balance(
  balance: ERC1155BalanceInput,
): NormalizedNFT {
  return {
    id: balance.id,
    tokenId: balance.tokenId,
    balance: balance.balance,
    contract: toAddress(balance.contract?.address),
    contractName: balance.contract?.name ?? 'Unknown',
    type: 'ERC1155',
  }
}

/**
 * Normalize a mixed query result into a unified NFT array
 */
export function normalizeNFTQueryResult(
  erc721Tokens: ERC721TokenInput[],
  erc1155Balances: ERC1155BalanceInput[],
): NormalizedNFT[] {
  const erc721Normalized = erc721Tokens.map(normalizeERC721Token)
  const erc1155Normalized = erc1155Balances.map(normalizeERC1155Balance)
  return [...erc721Normalized, ...erc1155Normalized]
}

// ============================================================================
// Filtering
// ============================================================================

/**
 * Filter NFTs by owner address
 */
export function filterNFTsByOwner(
  nfts: NormalizedNFT[],
  ownerAddress: string,
): NormalizedNFT[] {
  const normalizedOwner = ownerAddress.toLowerCase()
  return nfts.filter((nft) => {
    const ownsERC721 = nft.owner?.toLowerCase() === normalizedOwner
    const ownsERC1155 = Number(nft.balance) > 0
    return ownsERC721 || ownsERC1155
  })
}

// ============================================================================
// Sorting
// ============================================================================

export type NFTSortOption = 'recent' | 'collection' | 'price'

/**
 * Sort NFTs by the specified option
 */
export function sortNFTs(
  nfts: NormalizedNFT[],
  sortBy: NFTSortOption,
): NormalizedNFT[] {
  const sorted = [...nfts]

  switch (sortBy) {
    case 'collection':
      return sorted.sort((a, b) => a.contractName.localeCompare(b.contractName))
    case 'recent':
      return sorted.sort(
        (a, b) =>
          parseInt(b.tokenId ?? '0', 10) - parseInt(a.tokenId ?? '0', 10),
      )
    case 'price':
      // Price sorting would need price data - return as-is for now
      return sorted
    default:
      return sorted
  }
}

// ============================================================================
// Grouping
// ============================================================================

export type NFTCollectionGroup = Record<string, NormalizedNFT[]>

/**
 * Group NFTs by collection name
 */
export function groupNFTsByCollection(
  nfts: NormalizedNFT[],
): NFTCollectionGroup {
  return nfts.reduce((acc, nft) => {
    const collection = nft.contractName
    if (!acc[collection]) acc[collection] = []
    acc[collection].push(nft)
    return acc
  }, {} as NFTCollectionGroup)
}

// ============================================================================
// Auction Calculations
// ============================================================================

export interface AuctionState {
  seller: string
  nftContract: string
  tokenId: bigint
  reservePrice: bigint
  highestBid: bigint
  highestBidder: string
  endTime: bigint
  settled: boolean
}

/**
 * Calculate the minimum bid for an auction
 * Minimum is either the reserve price (if no bids) or highest bid + 5%
 */
export function calculateMinimumBid(auction: AuctionState): bigint {
  if (auction.highestBid > 0n) {
    // 5% increment on highest bid
    return (
      auction.highestBid +
      (auction.highestBid * BigInt(MIN_BID_INCREMENT_BPS)) / 10000n
    )
  }
  return auction.reservePrice
}

/**
 * Check if an auction is still active
 */
export function isAuctionActive(auction: AuctionState): boolean {
  const now = Math.floor(Date.now() / 1000)
  return Number(auction.endTime) >= now && !auction.settled
}

/**
 * Calculate time remaining in auction
 */
export function getAuctionTimeRemaining(auction: AuctionState): number {
  const now = Math.floor(Date.now() / 1000)
  return Math.max(0, Number(auction.endTime) - now)
}

/**
 * Format time remaining as human-readable string
 */
export function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'Ended'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// ============================================================================
// Listing Calculations
// ============================================================================

export interface ListingState {
  seller: string
  nftContract: string
  tokenId: bigint
  price: bigint
  active: boolean
  endTime: bigint
}

/**
 * Check if a listing is still active
 */
export function isListingActive(listing: ListingState): boolean {
  const now = Math.floor(Date.now() / 1000)
  if (listing.endTime && Number(listing.endTime) < now) {
    return false
  }
  return listing.active
}

// ============================================================================
// Price Validation
// ============================================================================

/**
 * Validate a listing price in ETH
 */
export function validateListingPrice(priceETH: string): {
  valid: boolean
  error?: string
} {
  const price = parseFloat(priceETH)

  if (Number.isNaN(price)) {
    return { valid: false, error: 'Invalid price format' }
  }

  if (price < MIN_LISTING_PRICE_ETH) {
    return {
      valid: false,
      error: `Minimum listing price is ${MIN_LISTING_PRICE_ETH} ETH`,
    }
  }

  return { valid: true }
}

/**
 * Validate a bid amount against auction state
 */
export function validateBidAmount(
  bidAmountETH: string,
  auction: AuctionState,
  bidderAddress: string,
): { valid: boolean; error?: string } {
  // Check auction is active
  if (!isAuctionActive(auction)) {
    return { valid: false, error: 'Auction is not active' }
  }

  // Check bidder is not already highest bidder
  if (auction.highestBidder.toLowerCase() === bidderAddress.toLowerCase()) {
    return { valid: false, error: 'You already have the highest bid' }
  }

  // Validate bid amount
  const bidAmount = parseEther(bidAmountETH)
  const minBid = calculateMinimumBid(auction)

  if (bidAmount < minBid) {
    return { valid: false, error: `Minimum bid: ${formatEther(minBid)} ETH` }
  }

  return { valid: true }
}

// ============================================================================
// Duration Conversion
// ============================================================================

/**
 * Convert days to seconds
 */
export function daysToSeconds(days: number): bigint {
  return BigInt(days * 24 * 60 * 60)
}

/**
 * Convert seconds to days
 */
export function secondsToDays(seconds: bigint): number {
  return Number(seconds) / (24 * 60 * 60)
}

// ============================================================================
// Address Utilities
// ============================================================================

/**
 * Check if an address owns an NFT
 */
export function isNFTOwner(nft: NormalizedNFT, address: string): boolean {
  if (!address) return false
  const normalizedAddress = address.toLowerCase()

  if (nft.type === 'ERC721') {
    return nft.owner?.toLowerCase() === normalizedAddress
  }

  // ERC1155 - check balance
  return Number(nft.balance) > 0
}

// Re-export formatAddress from shared package for backwards compatibility
export { formatAddress } from '@jejunetwork/shared'
