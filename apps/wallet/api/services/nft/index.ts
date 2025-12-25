/**
 * NFT Service
 * Uses network indexer for NFT data
 */

import type { Address, Hex } from 'viem'
import * as jeju from '../jeju'
import type { SupportedChainId } from '../rpc'

export interface NFT {
  contractAddress: Address
  tokenId: bigint
  chainId: SupportedChainId
  name: string
  description: string
  imageUrl: string
  tokenUri?: string
  standard: 'ERC721' | 'ERC1155'
  balance: bigint
  attributes?: Array<{ trait_type: string; value: string | number }>
  collectionName?: string
}

export interface NFTCollection {
  address: Address
  chainId: SupportedChainId
  name: string
  symbol: string
  nfts: NFT[]
}

class NFTService {
  private cache = new Map<string, NFT[]>()
  private cacheExpiry = 60_000 // 1 minute
  private cacheTime = new Map<string, number>()

  // Get all NFTs from indexer
  async getNFTs(owner: Address): Promise<NFT[]> {
    const cacheKey = `nfts:${owner}`
    const cached = this.cache.get(cacheKey)
    const time = this.cacheTime.get(cacheKey)

    if (cached && time && Date.now() - time < this.cacheExpiry) {
      return cached
    }

    try {
      const indexed = await jeju.getNFTs(owner)

      const nfts: NFT[] = indexed.map((nft) => ({
        contractAddress: nft.contractAddress as Address,
        tokenId: BigInt(nft.tokenId),
        chainId: nft.chainId as SupportedChainId,
        name: nft.metadata?.name || `#${nft.tokenId}`,
        description: nft.metadata?.description ?? '',
        imageUrl: this.resolveImageUrl(nft.metadata?.image ?? ''),
        tokenUri: nft.tokenUri || undefined,
        standard: 'ERC721',
        balance: 1n,
        attributes: nft.metadata?.attributes,
        collectionName: nft.collectionName,
      }))

      this.cache.set(cacheKey, nfts)
      this.cacheTime.set(cacheKey, Date.now())

      return nfts
    } catch (error) {
      console.error('Failed to fetch NFTs:', error)
      return cached ?? []
    }
  }

  // Get collections (grouped by contract)
  async getCollections(owner: Address): Promise<NFTCollection[]> {
    const nfts = await this.getNFTs(owner)
    const collections = new Map<string, NFTCollection>()

    for (const nft of nfts) {
      const key = `${nft.chainId}:${nft.contractAddress}`

      const existing = collections.get(key)
      if (existing) {
        existing.nfts.push(nft)
      } else {
        collections.set(key, {
          address: nft.contractAddress,
          chainId: nft.chainId,
          name: nft.collectionName ?? 'Unknown',
          symbol: '',
          nfts: [nft],
        })
      }
    }

    return Array.from(collections.values())
  }

  // Get single NFT
  async getNFT(
    chainId: SupportedChainId,
    contractAddress: Address,
    tokenId: bigint,
  ): Promise<NFT | null> {
    // First, check cache
    for (const [, nfts] of this.cache) {
      const found = nfts.find(
        (n) =>
          n.chainId === chainId &&
          n.contractAddress.toLowerCase() === contractAddress.toLowerCase() &&
          n.tokenId === tokenId,
      )
      if (found) return found
    }

    // Fetch from indexer if not in cache
    const indexed = await jeju.getNFT(contractAddress, tokenId.toString())
    if (!indexed) return null

    return {
      contractAddress: indexed.contractAddress as Address,
      tokenId: BigInt(indexed.tokenId),
      chainId: indexed.chainId as SupportedChainId,
      name: indexed.metadata?.name || `#${indexed.tokenId}`,
      description: indexed.metadata?.description ?? '',
      imageUrl: this.resolveImageUrl(indexed.metadata?.image ?? ''),
      tokenUri: indexed.tokenUri || undefined,
      standard: 'ERC721',
      balance: 1n,
      attributes: indexed.metadata?.attributes,
      collectionName: indexed.collectionName,
    }
  }

  // Transfer NFT (returns tx data, doesn't send)
  buildTransfer(
    _chainId: SupportedChainId,
    contractAddress: Address,
    tokenId: bigint,
    from: Address,
    to: Address,
  ): { to: Address; data: Hex; value: bigint } {
    // ERC721 transferFrom(from, to, tokenId)
    const selector = '0x23b872dd' // transferFrom
    const data = (selector +
      from.slice(2).padStart(64, '0') +
      to.slice(2).padStart(64, '0') +
      tokenId.toString(16).padStart(64, '0')) as Hex

    return { to: contractAddress, data, value: 0n }
  }

  // Resolve IPFS/HTTP URLs
  private resolveImageUrl(url: string): string {
    if (!url) return ''
    if (url.startsWith('ipfs://')) {
      return `https://ipfs.io/ipfs/${url.slice(7)}`
    }
    if (url.startsWith('ar://')) {
      return `https://arweave.net/${url.slice(5)}`
    }
    return url
  }

  clearCache(): void {
    this.cache.clear()
    this.cacheTime.clear()
  }
}

export const nftService = new NFTService()
export { NFTService }
