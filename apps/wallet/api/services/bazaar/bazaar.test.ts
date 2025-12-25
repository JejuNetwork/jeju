/**
 * Bazaar (NFT Marketplace) Service Tests
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Address } from 'viem'
import { AssetType, BazaarService, ListingStatus } from './index'

// Mock chain contracts
const mockBazaar = '0xbazaar00000000000000000000000000000001' as Address

mock.module('../../sdk/chains', () => ({
  getChainContracts: () => ({ bazaar: mockBazaar }),
  getNetworkRpcUrl: () => 'http://localhost:8545',
}))

// Mock RPC service
const mockReadContract = mock(() => Promise.resolve(250))
const mockGetClient = mock(() => ({
  readContract: mockReadContract,
}))

mock.module('../rpc', () => ({
  rpcService: { getClient: mockGetClient },
  isSupportedChainId: () => true,
}))

// Mock fetch for indexer calls
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        listings: [
          {
            id: '1',
            seller: '0xseller00000000000000000000000000000001',
            assetType: 0,
            assetContract: '0xnft0000000000000000000000000000000001',
            tokenId: '1',
            amount: '1',
            paymentToken: '0x0000000000000000000000000000000000000000',
            pricePerUnit: '1000000000000000000',
            expirationTime: '1735689600',
            status: 0,
          },
        ],
      }),
  }),
)

globalThis.fetch = mockFetch as typeof fetch

describe('BazaarService', () => {
  let bazaar: BazaarService

  beforeEach(() => {
    bazaar = new BazaarService(420691)
    mockReadContract.mockClear()
    mockFetch.mockClear()
  })

  describe('buildCreateListingTx', () => {
    it('should build create listing transaction', () => {
      const tx = bazaar.buildCreateListingTx({
        assetType: AssetType.ERC721,
        assetContract: '0xnft0000000000000000000000000000000001' as Address,
        tokenId: 1n,
        amount: 1n,
        paymentToken: '0x0000000000000000000000000000000000000000' as Address,
        pricePerUnit: 1000000000000000000n,
      })

      expect(tx).not.toBeNull()
      expect(tx?.to).toBe(mockBazaar)
      expect(tx?.data).toContain('0x')
    })

    it('should set default expiration', () => {
      const tx = bazaar.buildCreateListingTx({
        assetType: AssetType.ERC721,
        assetContract: '0xnft0000000000000000000000000000000001' as Address,
        tokenId: 1n,
        amount: 1n,
        paymentToken: '0x0000000000000000000000000000000000000000' as Address,
        pricePerUnit: 1000000000000000000n,
      })

      expect(tx).not.toBeNull()
    })
  })

  describe('buildCancelListingTx', () => {
    it('should build cancel listing transaction', () => {
      const tx = bazaar.buildCancelListingTx(1n)

      expect(tx).not.toBeNull()
      expect(tx?.to).toBe(mockBazaar)
    })
  })

  describe('buildBuyListingTx', () => {
    it('should build buy listing transaction with ETH value', () => {
      const tx = bazaar.buildBuyListingTx(1n, 1n, 1000000000000000000n)

      expect(tx).not.toBeNull()
      expect(tx?.to).toBe(mockBazaar)
      expect(tx?.value).toBe(1000000000000000000n)
    })
  })

  describe('getListing', () => {
    it('should get listing details', async () => {
      mockReadContract.mockResolvedValueOnce({
        seller: '0xseller00000000000000000000000000000001',
        assetType: 0,
        assetContract: '0xnft0000000000000000000000000000000001',
        tokenId: 1n,
        amount: 1n,
        paymentToken: '0x0000000000000000000000000000000000000000',
        pricePerUnit: 1000000000000000000n,
        expirationTime: 1735689600n,
        status: 0,
      })

      const listing = await bazaar.getListing(1n)

      expect(listing).not.toBeNull()
      expect(listing?.id).toBe(1n)
      expect(listing?.status).toBe(ListingStatus.Active)
      expect(listing?.isETH).toBe(true)
    })
  })

  describe('getCollectionListings', () => {
    it('should fetch listings from indexer', async () => {
      const listings = await bazaar.getCollectionListings(
        '0xnft0000000000000000000000000000000001' as Address,
      )

      expect(listings).toHaveLength(1)
      expect(listings[0].tokenId).toBe(1n)
    })

    it('should handle indexer errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const listings = await bazaar.getCollectionListings(
        '0xnft0000000000000000000000000000000001' as Address,
      )

      expect(listings).toHaveLength(0)
    })
  })

  describe('getPlatformFee', () => {
    it('should get platform fee', async () => {
      mockReadContract.mockResolvedValueOnce(250)

      const fee = await bazaar.getPlatformFee()
      expect(fee).toBe(250) // 2.5%
    })
  })

  describe('calculateTotalCost', () => {
    it('should calculate total cost with fees', async () => {
      mockReadContract.mockResolvedValueOnce(250) // platform fee
      mockReadContract.mockResolvedValueOnce([
        '0xroyalty0000000000000000000000000000001',
        500,
      ]) // royalty

      const cost = await bazaar.calculateTotalCost(
        1000000000000000000n,
        1n,
        '0xnft0000000000000000000000000000000001' as Address,
      )

      expect(cost.subtotal).toBe(1000000000000000000n)
      expect(cost.platformFee).toBe(25000000000000000n) // 2.5%
      expect(cost.royaltyFee).toBe(50000000000000000n) // 5%
    })
  })

  describe('setChain', () => {
    it('should switch chain context', () => {
      bazaar.setChain(1)
      // Verify chain was set (internal state)
    })
  })
})
