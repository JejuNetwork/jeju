/**
 * NFT library unit tests
 */

import { describe, expect, test } from 'bun:test'
import { parseEther } from 'viem'
import type { NormalizedNFT } from '@/schemas/nft'
import {
  // Types
  type AuctionState,
  // Auction
  calculateMinimumBid,
  // Duration
  daysToSeconds,
  // Filtering
  filterNFTsByOwner,
  formatAddress,
  formatTimeRemaining,
  getAuctionTimeRemaining,
  // Grouping
  groupNFTsByCollection,
  isAuctionActive,
  // Listing
  isListingActive,
  // Address
  isNFTOwner,
  type ListingState,
  // Constants
  MIN_LISTING_PRICE_ETH,
  // Normalization
  normalizeERC721Token,
  normalizeERC1155Balance,
  normalizeNFTQueryResult,
  secondsToDays,
  // Sorting
  sortNFTs,
  validateBidAmount,
  // Price validation
  validateListingPrice,
} from '../nft'

describe('NFT Normalization', () => {
  describe('normalizeERC721Token', () => {
    test('normalizes complete token data', () => {
      const token = {
        id: '0x123-1',
        tokenId: '1',
        owner: { address: '0xabcdef1234567890abcdef1234567890abcdef12' },
        contract: {
          address: '0x1234567890abcdef1234567890abcdef12345678',
          name: 'Test Collection',
        },
        metadata: '{"name":"Token #1"}',
      }

      const normalized = normalizeERC721Token(token)

      expect(normalized.id).toBe('0x123-1')
      expect(normalized.tokenId).toBe('1')
      expect(normalized.owner).toBe(
        '0xabcdef1234567890abcdef1234567890abcdef12',
      )
      expect(normalized.contract).toBe(
        '0x1234567890abcdef1234567890abcdef12345678',
      )
      expect(normalized.contractName).toBe('Test Collection')
      expect(normalized.type).toBe('ERC721')
      expect(normalized.metadata).toBe('{"name":"Token #1"}')
    })

    test('handles missing owner', () => {
      const token = {
        id: '0x123-1',
        tokenId: '1',
        contract: {
          address: '0x1234567890abcdef1234567890abcdef12345678',
          name: 'Test Collection',
        },
      }

      const normalized = normalizeERC721Token(token)
      expect(normalized.owner).toBeUndefined()
    })

    test('handles missing contract name', () => {
      const token = {
        id: '0x123-1',
        tokenId: '1',
        contract: {
          address: '0x1234567890abcdef1234567890abcdef12345678',
          name: '',
        },
      }

      const normalized = normalizeERC721Token(token)
      expect(normalized.contractName).toBe('')
    })

    test('handles completely missing contract', () => {
      const token = {
        id: '0x123-1',
        tokenId: '1',
      }

      const normalized = normalizeERC721Token(token)
      expect(normalized.contract).toBeUndefined()
      expect(normalized.contractName).toBe('Unknown')
    })
  })

  describe('normalizeERC1155Balance', () => {
    test('normalizes complete balance data', () => {
      const balance = {
        id: '0x456-2',
        tokenId: '2',
        balance: '10',
        contract: {
          address: '0x9876543210fedcba9876543210fedcba98765432',
          name: 'Items Collection',
        },
      }

      const normalized = normalizeERC1155Balance(balance)

      expect(normalized.id).toBe('0x456-2')
      expect(normalized.tokenId).toBe('2')
      expect(normalized.balance).toBe('10')
      expect(normalized.contract).toBe(
        '0x9876543210fedcba9876543210fedcba98765432',
      )
      expect(normalized.contractName).toBe('Items Collection')
      expect(normalized.type).toBe('ERC1155')
    })

    test('handles missing contract', () => {
      const balance = {
        id: '0x456-2',
        tokenId: '2',
        balance: '5',
      }

      const normalized = normalizeERC1155Balance(balance)
      expect(normalized.contract).toBeUndefined()
      expect(normalized.contractName).toBe('Unknown')
    })
  })

  describe('normalizeNFTQueryResult', () => {
    test('combines ERC721 and ERC1155 results', () => {
      const erc721Tokens = [
        {
          id: '1',
          tokenId: '1',
          contract: {
            address: '0x1234567890abcdef1234567890abcdef12345678',
            name: 'NFTs',
          },
        },
      ]
      const erc1155Balances = [
        {
          id: '2',
          tokenId: '100',
          balance: '5',
          contract: {
            address: '0x9876543210fedcba9876543210fedcba98765432',
            name: 'Items',
          },
        },
      ]

      const result = normalizeNFTQueryResult(erc721Tokens, erc1155Balances)

      expect(result.length).toBe(2)
      expect(result[0].type).toBe('ERC721')
      expect(result[1].type).toBe('ERC1155')
    })

    test('handles empty arrays', () => {
      const result = normalizeNFTQueryResult([], [])
      expect(result).toEqual([])
    })
  })
})

describe('NFT Filtering', () => {
  const testNFTs: NormalizedNFT[] = [
    {
      id: '1',
      tokenId: '1',
      owner: '0xUser1',
      contractName: 'Collection A',
      type: 'ERC721',
    },
    {
      id: '2',
      tokenId: '2',
      owner: '0xUser2',
      contractName: 'Collection A',
      type: 'ERC721',
    },
    {
      id: '3',
      tokenId: '3',
      balance: '5',
      contractName: 'Collection B',
      type: 'ERC1155',
    },
    {
      id: '4',
      tokenId: '4',
      balance: '0',
      contractName: 'Collection B',
      type: 'ERC1155',
    },
  ]

  describe('filterNFTsByOwner', () => {
    test('filters ERC721 by owner address', () => {
      const filtered = filterNFTsByOwner(testNFTs, '0xUser1')
      expect(filtered.length).toBe(2) // The owned ERC721 + ERC1155 with balance > 0
      expect(filtered[0].id).toBe('1')
    })

    test('is case-insensitive for addresses', () => {
      const filtered = filterNFTsByOwner(testNFTs, '0xUSER1')
      expect(filtered.some((nft) => nft.id === '1')).toBe(true)
    })

    test('includes ERC1155 with positive balance', () => {
      const filtered = filterNFTsByOwner(testNFTs, '0xSomeoneElse')
      // Should include the ERC1155 with balance > 0
      expect(filtered.some((nft) => nft.id === '3')).toBe(true)
    })

    test('excludes ERC1155 with zero balance', () => {
      const filtered = filterNFTsByOwner(testNFTs, '0xSomeoneElse')
      expect(filtered.some((nft) => nft.id === '4')).toBe(false)
    })
  })
})

describe('NFT Sorting', () => {
  const testNFTs: NormalizedNFT[] = [
    {
      id: '1',
      tokenId: '10',
      contractName: 'Zebra Collection',
      type: 'ERC721',
    },
    { id: '2', tokenId: '5', contractName: 'Apple Collection', type: 'ERC721' },
    {
      id: '3',
      tokenId: '20',
      contractName: 'Mango Collection',
      type: 'ERC721',
    },
  ]

  describe('sortNFTs', () => {
    test('sorts by collection name alphabetically', () => {
      const sorted = sortNFTs(testNFTs, 'collection')
      expect(sorted[0].contractName).toBe('Apple Collection')
      expect(sorted[1].contractName).toBe('Mango Collection')
      expect(sorted[2].contractName).toBe('Zebra Collection')
    })

    test('sorts by recent (highest tokenId first)', () => {
      const sorted = sortNFTs(testNFTs, 'recent')
      expect(sorted[0].tokenId).toBe('20')
      expect(sorted[1].tokenId).toBe('10')
      expect(sorted[2].tokenId).toBe('5')
    })

    test('price sort returns array as-is (no price data)', () => {
      const sorted = sortNFTs(testNFTs, 'price')
      expect(sorted.length).toBe(3)
    })

    test('does not mutate original array', () => {
      const original = [...testNFTs]
      sortNFTs(testNFTs, 'collection')
      expect(testNFTs).toEqual(original)
    })
  })
})

describe('NFT Grouping', () => {
  describe('groupNFTsByCollection', () => {
    test('groups NFTs by collection name', () => {
      const nfts: NormalizedNFT[] = [
        { id: '1', tokenId: '1', contractName: 'Collection A', type: 'ERC721' },
        { id: '2', tokenId: '2', contractName: 'Collection B', type: 'ERC721' },
        { id: '3', tokenId: '3', contractName: 'Collection A', type: 'ERC721' },
      ]

      const grouped = groupNFTsByCollection(nfts)

      expect(Object.keys(grouped).length).toBe(2)
      expect(grouped['Collection A'].length).toBe(2)
      expect(grouped['Collection B'].length).toBe(1)
    })

    test('handles empty array', () => {
      const grouped = groupNFTsByCollection([])
      expect(Object.keys(grouped).length).toBe(0)
    })
  })
})

describe('Auction Calculations', () => {
  const baseAuction: AuctionState = {
    seller: '0xSeller',
    nftContract: '0xNFT',
    tokenId: 1n,
    reservePrice: parseEther('1'),
    highestBid: 0n,
    highestBidder: '0x0000000000000000000000000000000000000000',
    endTime: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour from now
    settled: false,
  }

  describe('calculateMinimumBid', () => {
    test('returns reserve price when no bids', () => {
      const minBid = calculateMinimumBid(baseAuction)
      expect(minBid).toBe(parseEther('1'))
    })

    test('returns 5% increment on highest bid', () => {
      const auctionWithBid = {
        ...baseAuction,
        highestBid: parseEther('1'),
      }

      const minBid = calculateMinimumBid(auctionWithBid)
      expect(minBid).toBe(parseEther('1.05'))
    })

    test('handles large bids correctly', () => {
      const auctionWithLargeBid = {
        ...baseAuction,
        highestBid: parseEther('100'),
      }

      const minBid = calculateMinimumBid(auctionWithLargeBid)
      expect(minBid).toBe(parseEther('105'))
    })
  })

  describe('isAuctionActive', () => {
    test('returns true for active auction', () => {
      expect(isAuctionActive(baseAuction)).toBe(true)
    })

    test('returns false for ended auction', () => {
      const endedAuction = {
        ...baseAuction,
        endTime: BigInt(Math.floor(Date.now() / 1000) - 3600), // 1 hour ago
      }
      expect(isAuctionActive(endedAuction)).toBe(false)
    })

    test('returns false for settled auction', () => {
      const settledAuction = {
        ...baseAuction,
        settled: true,
      }
      expect(isAuctionActive(settledAuction)).toBe(false)
    })
  })

  describe('getAuctionTimeRemaining', () => {
    test('returns positive seconds for active auction', () => {
      const remaining = getAuctionTimeRemaining(baseAuction)
      expect(remaining).toBeGreaterThan(0)
      expect(remaining).toBeLessThanOrEqual(3600)
    })

    test('returns 0 for ended auction', () => {
      const endedAuction = {
        ...baseAuction,
        endTime: BigInt(Math.floor(Date.now() / 1000) - 100),
      }
      expect(getAuctionTimeRemaining(endedAuction)).toBe(0)
    })
  })

  describe('formatTimeRemaining', () => {
    test('formats days and hours', () => {
      const result = formatTimeRemaining(90000) // 1 day + 1 hour
      expect(result).toBe('1d 1h')
    })

    test('formats hours and minutes', () => {
      const result = formatTimeRemaining(3660) // 1 hour + 1 minute
      expect(result).toBe('1h 1m')
    })

    test('formats minutes only', () => {
      const result = formatTimeRemaining(300) // 5 minutes
      expect(result).toBe('5m')
    })

    test('returns Ended for 0 or negative', () => {
      expect(formatTimeRemaining(0)).toBe('Ended')
      expect(formatTimeRemaining(-100)).toBe('Ended')
    })
  })
})

describe('Listing Functions', () => {
  describe('isListingActive', () => {
    test('returns true for active listing without end time', () => {
      const listing: ListingState = {
        seller: '0xSeller',
        nftContract: '0xNFT',
        tokenId: 1n,
        price: parseEther('1'),
        active: true,
        endTime: 0n,
      }
      expect(isListingActive(listing)).toBe(true)
    })

    test('returns true for active listing with future end time', () => {
      const listing: ListingState = {
        seller: '0xSeller',
        nftContract: '0xNFT',
        tokenId: 1n,
        price: parseEther('1'),
        active: true,
        endTime: BigInt(Math.floor(Date.now() / 1000) + 3600),
      }
      expect(isListingActive(listing)).toBe(true)
    })

    test('returns false for inactive listing', () => {
      const listing: ListingState = {
        seller: '0xSeller',
        nftContract: '0xNFT',
        tokenId: 1n,
        price: parseEther('1'),
        active: false,
        endTime: 0n,
      }
      expect(isListingActive(listing)).toBe(false)
    })

    test('returns false for expired listing', () => {
      const listing: ListingState = {
        seller: '0xSeller',
        nftContract: '0xNFT',
        tokenId: 1n,
        price: parseEther('1'),
        active: true,
        endTime: BigInt(Math.floor(Date.now() / 1000) - 3600),
      }
      expect(isListingActive(listing)).toBe(false)
    })
  })
})

describe('Price Validation', () => {
  describe('validateListingPrice', () => {
    test('accepts valid price above minimum', () => {
      const result = validateListingPrice('1.0')
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    test('accepts minimum price exactly', () => {
      const result = validateListingPrice(String(MIN_LISTING_PRICE_ETH))
      expect(result.valid).toBe(true)
    })

    test('rejects price below minimum', () => {
      const result = validateListingPrice('0.0001')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Minimum')
    })

    test('rejects invalid number format', () => {
      const result = validateListingPrice('not-a-number')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid')
    })
  })

  describe('validateBidAmount', () => {
    const activeAuction: AuctionState = {
      seller: '0xSeller',
      nftContract: '0xNFT',
      tokenId: 1n,
      reservePrice: parseEther('1'),
      highestBid: parseEther('1'),
      highestBidder: '0xPreviousBidder',
      endTime: BigInt(Math.floor(Date.now() / 1000) + 3600),
      settled: false,
    }

    test('accepts valid bid above minimum', () => {
      const result = validateBidAmount('1.1', activeAuction, '0xNewBidder')
      expect(result.valid).toBe(true)
    })

    test('rejects bid below minimum increment', () => {
      const result = validateBidAmount('1.01', activeAuction, '0xNewBidder')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Minimum bid')
    })

    test('rejects bid from current highest bidder', () => {
      const result = validateBidAmount('2.0', activeAuction, '0xPreviousBidder')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('already have the highest bid')
    })

    test('rejects bid on inactive auction', () => {
      const endedAuction = {
        ...activeAuction,
        endTime: BigInt(Math.floor(Date.now() / 1000) - 3600),
      }
      const result = validateBidAmount('2.0', endedAuction, '0xNewBidder')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('not active')
    })
  })
})

describe('Duration Conversion', () => {
  describe('daysToSeconds', () => {
    test('converts 1 day correctly', () => {
      expect(daysToSeconds(1)).toBe(86400n)
    })

    test('converts 7 days correctly', () => {
      expect(daysToSeconds(7)).toBe(604800n)
    })

    test('converts 0 days', () => {
      expect(daysToSeconds(0)).toBe(0n)
    })
  })

  describe('secondsToDays', () => {
    test('converts 86400 seconds to 1 day', () => {
      expect(secondsToDays(86400n)).toBe(1)
    })

    test('converts 604800 seconds to 7 days', () => {
      expect(secondsToDays(604800n)).toBe(7)
    })

    test('handles partial days', () => {
      expect(secondsToDays(129600n)).toBe(1.5)
    })
  })
})

describe('Address Utilities', () => {
  describe('isNFTOwner', () => {
    test('returns true for ERC721 owner', () => {
      const nft: NormalizedNFT = {
        id: '1',
        tokenId: '1',
        owner: '0xOwner123',
        contractName: 'Test',
        type: 'ERC721',
      }
      expect(isNFTOwner(nft, '0xOwner123')).toBe(true)
    })

    test('is case-insensitive', () => {
      const nft: NormalizedNFT = {
        id: '1',
        tokenId: '1',
        owner: '0xowner123',
        contractName: 'Test',
        type: 'ERC721',
      }
      expect(isNFTOwner(nft, '0xOWNER123')).toBe(true)
    })

    test('returns false for non-owner ERC721', () => {
      const nft: NormalizedNFT = {
        id: '1',
        tokenId: '1',
        owner: '0xOwner123',
        contractName: 'Test',
        type: 'ERC721',
      }
      expect(isNFTOwner(nft, '0xSomeoneElse')).toBe(false)
    })

    test('returns true for ERC1155 with positive balance', () => {
      const nft: NormalizedNFT = {
        id: '1',
        tokenId: '1',
        balance: '5',
        contractName: 'Test',
        type: 'ERC1155',
      }
      expect(isNFTOwner(nft, '0xAnyAddress')).toBe(true)
    })

    test('returns false for ERC1155 with zero balance', () => {
      const nft: NormalizedNFT = {
        id: '1',
        tokenId: '1',
        balance: '0',
        contractName: 'Test',
        type: 'ERC1155',
      }
      expect(isNFTOwner(nft, '0xAnyAddress')).toBe(false)
    })

    test('returns false for empty address', () => {
      const nft: NormalizedNFT = {
        id: '1',
        tokenId: '1',
        owner: '0xOwner123',
        contractName: 'Test',
        type: 'ERC721',
      }
      expect(isNFTOwner(nft, '')).toBe(false)
    })
  })

  describe('formatAddress', () => {
    test('truncates long address', () => {
      const address = '0x1234567890abcdef1234567890abcdef12345678'
      const formatted = formatAddress(address)
      expect(formatted).toBe('0x1234...5678')
    })

    test('uses custom truncation lengths', () => {
      const address = '0x1234567890abcdef1234567890abcdef12345678'
      const formatted = formatAddress(address, 8, 6)
      expect(formatted).toBe('0x123456...345678')
    })

    test('returns short address as-is', () => {
      const address = '0x1234'
      const formatted = formatAddress(address)
      expect(formatted).toBe('0x1234')
    })
  })
})

describe('Schema Exports', () => {
  test('ListingParamsSchema validates correct input', () => {
    const { ListingParamsSchema } = require('../nft')
    const result = ListingParamsSchema.safeParse({
      nftContract: '0x1234567890abcdef1234567890abcdef12345678',
      tokenId: 1n,
      priceETH: '1.0',
      durationDays: 7,
    })
    expect(result.success).toBe(true)
  })

  test('AuctionParamsSchema validates correct input', () => {
    const { AuctionParamsSchema } = require('../nft')
    const result = AuctionParamsSchema.safeParse({
      nftContract: '0x1234567890abcdef1234567890abcdef12345678',
      tokenId: 1n,
      reservePriceETH: '1.0',
      durationDays: 3,
    })
    expect(result.success).toBe(true)
  })

  test('BidParamsSchema validates correct input', () => {
    const { BidParamsSchema } = require('../nft')
    const result = BidParamsSchema.safeParse({
      auctionId: 1n,
      bidAmountETH: '1.5',
    })
    expect(result.success).toBe(true)
  })

  test('OfferParamsSchema validates correct input', () => {
    const { OfferParamsSchema } = require('../nft')
    const result = OfferParamsSchema.safeParse({
      nftContract: '0x1234567890abcdef1234567890abcdef12345678',
      tokenId: 1n,
      offerPriceETH: '0.5',
    })
    expect(result.success).toBe(true)
  })
})
