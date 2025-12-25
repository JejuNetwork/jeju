/**
 * NFT Service Tests
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Address } from 'viem'
import { NFTService } from './index'

// Mock jeju service
const mockGetNFTs = mock(() =>
  Promise.resolve([
    {
      contractAddress: '0xnft0000000000000000000000000000000000001',
      tokenId: '1',
      chainId: 1,
      owner: '0x1234567890123456789012345678901234567890',
      tokenUri: 'ipfs://Qm123',
      collectionName: 'Test Collection',
      metadata: {
        name: 'Test NFT #1',
        description: 'A test NFT',
        image: 'ipfs://Qmimage',
        attributes: [{ trait_type: 'Rarity', value: 'Common' }],
      },
    },
    {
      contractAddress: '0xnft0000000000000000000000000000000000001',
      tokenId: '2',
      chainId: 1,
      owner: '0x1234567890123456789012345678901234567890',
      tokenUri: null,
      collectionName: 'Test Collection',
      metadata: null,
    },
  ]),
)

mock.module('../jeju', () => ({
  getNFTs: mockGetNFTs,
}))

describe('NFTService', () => {
  let nftService: NFTService

  beforeEach(() => {
    nftService = new NFTService()
    nftService.clearCache()
    mockGetNFTs.mockClear()
  })

  describe('getNFTs', () => {
    it('should fetch NFTs for owner', async () => {
      const nfts = await nftService.getNFTs(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(nfts).toHaveLength(2)
      expect(nfts[0].name).toBe('Test NFT #1')
      expect(nfts[0].description).toBe('A test NFT')
      expect(nfts[0].collectionName).toBe('Test Collection')
    })

    it('should cache results', async () => {
      const owner = '0x1234567890123456789012345678901234567890' as Address
      await nftService.getNFTs(owner)
      await nftService.getNFTs(owner)

      expect(mockGetNFTs).toHaveBeenCalledTimes(1)
    })

    it('should resolve IPFS URLs', async () => {
      const nfts = await nftService.getNFTs(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(nfts[0].imageUrl).toBe('https://ipfs.io/ipfs/Qmimage')
    })

    it('should handle missing metadata', async () => {
      const nfts = await nftService.getNFTs(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(nfts[1].name).toBe('#2')
      expect(nfts[1].description).toBe('')
    })
  })

  describe('getCollections', () => {
    it('should group NFTs by collection', async () => {
      const collections = await nftService.getCollections(
        '0x1234567890123456789012345678901234567890' as Address,
      )

      expect(collections).toHaveLength(1)
      expect(collections[0].name).toBe('Test Collection')
      expect(collections[0].nfts).toHaveLength(2)
    })
  })

  describe('getNFT', () => {
    it('should find specific NFT in cache', async () => {
      const owner = '0x1234567890123456789012345678901234567890' as Address
      await nftService.getNFTs(owner)

      const nft = await nftService.getNFT(
        1,
        '0xnft0000000000000000000000000000000000001' as Address,
        1n,
      )

      expect(nft?.name).toBe('Test NFT #1')
    })

    it('should return null for non-existent NFT', async () => {
      const nft = await nftService.getNFT(
        1,
        '0xnonexistent000000000000000000000000000' as Address,
        999n,
      )

      expect(nft).toBeNull()
    })
  })

  describe('buildTransfer', () => {
    it('should build transfer transaction data', () => {
      const tx = nftService.buildTransfer(
        1,
        '0xnft0000000000000000000000000000000000001' as Address,
        1n,
        '0xfrom000000000000000000000000000000000001' as Address,
        '0xto00000000000000000000000000000000000002' as Address,
      )

      expect(tx.to).toBe('0xnft0000000000000000000000000000000000001')
      expect(tx.data).toContain('0x23b872dd') // transferFrom selector
      expect(tx.value).toBe(0n)
    })
  })

  describe('clearCache', () => {
    it('should clear the cache', async () => {
      const owner = '0x1234567890123456789012345678901234567890' as Address
      await nftService.getNFTs(owner)
      expect(mockGetNFTs).toHaveBeenCalledTimes(1)

      nftService.clearCache()
      await nftService.getNFTs(owner)
      expect(mockGetNFTs).toHaveBeenCalledTimes(2)
    })
  })
})
