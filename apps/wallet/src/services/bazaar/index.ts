/**
 * Bazaar Service - NFT Marketplace
 * List, buy, sell NFTs with multi-currency support
 */

import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  type Hex,
  http,
  type PublicClient,
} from 'viem'
import { getChainContracts, getNetworkRpcUrl } from '../../sdk/chains'
import { rpcService, SUPPORTED_CHAINS, type SupportedChainId } from '../rpc'

const BAZAAR_ABI = [
  // Listing management
  {
    inputs: [
      { name: 'assetType', type: 'uint8' },
      { name: 'assetContract', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'paymentToken', type: 'address' },
      { name: 'pricePerUnit', type: 'uint256' },
      { name: 'expirationTime', type: 'uint256' },
    ],
    name: 'createListing',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'listingId', type: 'uint256' }],
    name: 'cancelListing',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'listingId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'buyListing',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  // View functions
  {
    inputs: [{ name: 'listingId', type: 'uint256' }],
    name: 'getListing',
    outputs: [
      {
        components: [
          { name: 'seller', type: 'address' },
          { name: 'assetType', type: 'uint8' },
          { name: 'assetContract', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'paymentToken', type: 'address' },
          { name: 'pricePerUnit', type: 'uint256' },
          { name: 'expirationTime', type: 'uint256' },
          { name: 'status', type: 'uint8' },
        ],
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'nextListingId',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'platformFeeBps',
    outputs: [{ type: 'uint16' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Royalties
  {
    inputs: [{ name: 'collection', type: 'address' }],
    name: 'getRoyaltyInfo',
    outputs: [
      { name: 'receiver', type: 'address' },
      { name: 'royaltyBps', type: 'uint16' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export enum AssetType {
  ERC721 = 0,
  ERC1155 = 1,
  ERC20 = 2,
}

export enum ListingStatus {
  Active = 0,
  Sold = 1,
  Cancelled = 2,
  Expired = 3,
}

export interface Listing {
  id: bigint
  seller: Address
  assetType: AssetType
  assetContract: Address
  tokenId: bigint
  amount: bigint
  paymentToken: Address
  pricePerUnit: bigint
  expirationTime: bigint
  status: ListingStatus
  // Computed
  totalPrice: bigint
  isETH: boolean
  chainId: number
}

export interface CreateListingParams {
  assetType: AssetType
  assetContract: Address
  tokenId: bigint
  amount: bigint
  paymentToken: Address // address(0) for ETH
  pricePerUnit: bigint
  expirationDays?: number
}

export interface CollectionInfo {
  address: Address
  name: string
  symbol: string
  royaltyReceiver: Address
  royaltyBps: number
  floorPrice?: bigint
  totalVolume?: bigint
  listingCount: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const DEFAULT_EXPIRATION_DAYS = 30

export class BazaarService {
  private chainId: number
  private clientCache = new Map<number, PublicClient>()

  constructor(chainId: number = 420691) {
    this.chainId = chainId
  }

  setChain(chainId: number) {
    this.chainId = chainId
  }

  private getBazaarAddress(): Address | undefined {
    return getChainContracts(this.chainId).bazaar
  }

  private getClient(): PublicClient {
    if (this.chainId in SUPPORTED_CHAINS) {
      return rpcService.getClient(this.chainId as SupportedChainId)
    }
    const cached = this.clientCache.get(this.chainId)
    if (cached) {
      return cached
    }
    const rpcUrl = getNetworkRpcUrl(this.chainId) || 'http://localhost:9545'
    const client = createPublicClient({ transport: http(rpcUrl) })
    this.clientCache.set(this.chainId, client)
    return client
  }

  /**
   * Create a new listing
   */
  buildCreateListingTx(
    params: CreateListingParams,
  ): { to: Address; data: Hex } | null {
    const bazaar = this.getBazaarAddress()
    if (!bazaar) return null

    const expirationTime = BigInt(
      Math.floor(Date.now() / 1000) +
        (params.expirationDays || DEFAULT_EXPIRATION_DAYS) * 86400,
    )

    const data = encodeFunctionData({
      abi: BAZAAR_ABI,
      functionName: 'createListing',
      args: [
        params.assetType,
        params.assetContract,
        params.tokenId,
        params.amount,
        params.paymentToken,
        params.pricePerUnit,
        expirationTime,
      ],
    })

    return { to: bazaar, data }
  }

  /**
   * Cancel a listing
   */
  buildCancelListingTx(listingId: bigint): { to: Address; data: Hex } | null {
    const bazaar = this.getBazaarAddress()
    if (!bazaar) return null

    const data = encodeFunctionData({
      abi: BAZAAR_ABI,
      functionName: 'cancelListing',
      args: [listingId],
    })

    return { to: bazaar, data }
  }

  /**
   * Buy from a listing
   */
  buildBuyListingTx(
    listingId: bigint,
    amount: bigint,
    ethValue: bigint,
  ): { to: Address; data: Hex; value: bigint } | null {
    const bazaar = this.getBazaarAddress()
    if (!bazaar) return null

    const data = encodeFunctionData({
      abi: BAZAAR_ABI,
      functionName: 'buyListing',
      args: [listingId, amount],
    })

    return { to: bazaar, data, value: ethValue }
  }

  /**
   * Get listing details
   */
  async getListing(listingId: bigint): Promise<Listing | null> {
    const bazaar = this.getBazaarAddress()
    if (!bazaar) return null

    const client = this.getClient()
    const listing = await client.readContract({
      address: bazaar,
      abi: BAZAAR_ABI,
      functionName: 'getListing',
      args: [listingId],
    })

    return {
      id: listingId,
      seller: listing.seller,
      assetType: listing.assetType as AssetType,
      assetContract: listing.assetContract,
      tokenId: listing.tokenId,
      amount: listing.amount,
      paymentToken: listing.paymentToken,
      pricePerUnit: listing.pricePerUnit,
      expirationTime: listing.expirationTime,
      status: listing.status as ListingStatus,
      totalPrice: listing.pricePerUnit * listing.amount,
      isETH: listing.paymentToken === ZERO_ADDRESS,
      chainId: this.chainId,
    }
  }

  /**
   * Get active listings for a collection
   */
  async getCollectionListings(
    collectionAddress: Address,
    limit: number = 50,
  ): Promise<Listing[]> {
    const bazaar = this.getBazaarAddress()
    if (!bazaar) return []

    // In production, use indexer. For now, scan recent listings
    const client = this.getClient()
    const nextId = await client.readContract({
      address: bazaar,
      abi: BAZAAR_ABI,
      functionName: 'nextListingId',
      args: [],
    })

    const listings: Listing[] = []
    const startId = nextId > BigInt(limit) ? nextId - BigInt(limit) : 1n

    for (let i = startId; i < nextId && listings.length < limit; i++) {
      const listing = await this.getListing(i)
      if (
        listing &&
        listing.status === ListingStatus.Active &&
        listing.assetContract.toLowerCase() === collectionAddress.toLowerCase()
      ) {
        listings.push(listing)
      }
    }

    return listings
  }

  /**
   * Get royalty info for a collection
   */
  async getRoyaltyInfo(
    collectionAddress: Address,
  ): Promise<{ receiver: Address; royaltyBps: number } | null> {
    const bazaar = this.getBazaarAddress()
    if (!bazaar) return null

    const client = this.getClient()
    const [receiver, royaltyBps] = await client.readContract({
      address: bazaar,
      abi: BAZAAR_ABI,
      functionName: 'getRoyaltyInfo',
      args: [collectionAddress],
    })

    return { receiver, royaltyBps }
  }

  /**
   * Get platform fee
   */
  async getPlatformFee(): Promise<number> {
    const bazaar = this.getBazaarAddress()
    if (!bazaar) return 250 // Default 2.5%

    const client = this.getClient()
    return client.readContract({
      address: bazaar,
      abi: BAZAAR_ABI,
      functionName: 'platformFeeBps',
      args: [],
    })
  }

  /**
   * Calculate total cost including fees
   */
  async calculateTotalCost(
    pricePerUnit: bigint,
    amount: bigint,
    collectionAddress: Address,
  ): Promise<{
    subtotal: bigint
    platformFee: bigint
    royaltyFee: bigint
    total: bigint
  }> {
    const subtotal = pricePerUnit * amount
    const platformFeeBps = await this.getPlatformFee()
    const royaltyInfo = await this.getRoyaltyInfo(collectionAddress)

    const platformFee = (subtotal * BigInt(platformFeeBps)) / 10000n
    const royaltyFee = royaltyInfo
      ? (subtotal * BigInt(royaltyInfo.royaltyBps)) / 10000n
      : 0n

    return {
      subtotal,
      platformFee,
      royaltyFee,
      total: subtotal + platformFee + royaltyFee,
    }
  }
}

export const bazaarService = new BazaarService()
