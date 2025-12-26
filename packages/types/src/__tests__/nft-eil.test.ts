import { describe, expect, it } from 'bun:test'
import {
  NFTAssetTypeSchema,
  NFTVoucherStatusSchema,
  NFTVoucherRequestSchema,
  NFTVoucherSchema,
  WrappedNFTInfoSchema,
  ProvenanceEntrySchema,
  CrossChainNFTTransferSchema,
  NFTCollectionInfoSchema,
  XLPNFTLiquiditySchema,
  NFTBridgeQuoteSchema,
  NFTIntentOrderSchema,
  NFTEILEventTypeSchema,
  NFTEILEventSchema,
  NFTEILConfigSchema,
  NFTEILStatsSchema,
  NFTBridgeModeSchema,
  CrossChainNFTParamsSchema,
  NFTBridgeResultSchema,
  WrappedNFTDetailsSchema,
} from '../nft-eil'

describe('NFT EIL Types', () => {
  describe('NFTAssetTypeSchema', () => {
    it('validates all NFT asset types', () => {
      const types = ['ERC721', 'ERC1155']
      for (const type of types) {
        expect(NFTAssetTypeSchema.parse(type)).toBe(type)
      }
    })
  })

  describe('NFTVoucherStatusSchema', () => {
    it('validates all voucher statuses', () => {
      const statuses = ['pending', 'claimed', 'fulfilled', 'expired', 'failed', 'refunded']
      for (const status of statuses) {
        expect(NFTVoucherStatusSchema.parse(status)).toBe(status)
      }
    })
  })

  describe('NFTVoucherRequestSchema', () => {
    it('validates NFT voucher request', () => {
      const request = {
        requestId: '0x1234',
        requester: '0x1234567890123456789012345678901234567890',
        assetType: 'ERC721',
        sourceChain: 1,
        destinationChain: 10,
        collection: '0x2345678901234567890123456789012345678901',
        tokenId: '1234',
        amount: '1',
        recipient: '0x3456789012345678901234567890123456789012',
        gasOnDestination: '100000',
        maxFee: '1000000000000000',
        currentFee: '500000000000000',
        feeIncrement: '100000000000000',
        metadataHash: '0xabcd1234',
        deadline: Date.now() + 3600000,
        createdAt: Date.now(),
        createdBlock: 12345678,
        status: 'pending',
        bidCount: 3,
        winningXLP: '0x4567890123456789012345678901234567890123',
        winningFee: '450000000000000',
      }
      expect(() => NFTVoucherRequestSchema.parse(request)).not.toThrow()
    })
  })

  describe('NFTVoucherSchema', () => {
    it('validates NFT voucher', () => {
      const voucher = {
        voucherId: '0xabcd1234',
        requestId: '0x1234',
        xlp: '0x1234567890123456789012345678901234567890',
        assetType: 'ERC721',
        sourceChainId: 1,
        destinationChainId: 10,
        sourceCollection: '0x2345678901234567890123456789012345678901',
        destinationCollection: '0x3456789012345678901234567890123456789012',
        tokenId: '1234',
        amount: '1',
        fee: '500000000000000',
        gasProvided: '100000',
        signature: '0xsig...',
        issuedAt: Date.now(),
        issuedBlock: 12345678,
        expiresAt: Date.now() + 3600000,
        status: 'claimed',
        sourceClaimTx: '0xtx1...',
        destinationFulfillTx: '0xtx2...',
      }
      expect(() => NFTVoucherSchema.parse(voucher)).not.toThrow()
    })
  })

  describe('WrappedNFTInfoSchema', () => {
    it('validates wrapped NFT info', () => {
      const info = {
        wrappedTokenId: '9999',
        wrappedCollection: '0x1234567890123456789012345678901234567890',
        homeChainId: 1,
        originalCollection: '0x2345678901234567890123456789012345678901',
        originalTokenId: '1234',
        tokenURI: 'https://example.com/token/1234',
        metadataHash: '0xmetahash',
        bridgedAt: Date.now(),
        bridgedBy: '0x3456789012345678901234567890123456789012',
        name: 'Cool NFT',
        description: 'A very cool NFT',
        image: 'https://example.com/image.png',
        attributes: [
          { trait_type: 'rarity', value: 'legendary' },
          { color: 'blue' },
        ],
      }
      expect(() => WrappedNFTInfoSchema.parse(info)).not.toThrow()
    })
  })

  describe('ProvenanceEntrySchema', () => {
    it('validates provenance entry', () => {
      const entry = {
        chainId: 1,
        collection: '0x1234567890123456789012345678901234567890',
        tokenId: '1234',
        timestamp: Date.now(),
        txHash: '0xtx...',
        owner: '0x2345678901234567890123456789012345678901',
        eventType: 'mint',
      }
      expect(() => ProvenanceEntrySchema.parse(entry)).not.toThrow()
    })

    it('validates all event types', () => {
      const eventTypes = ['mint', 'transfer', 'bridge_out', 'bridge_in', 'wrap', 'unwrap']
      for (const eventType of eventTypes) {
        expect(() =>
          ProvenanceEntrySchema.parse({
            chainId: 1,
            collection: '0x1234567890123456789012345678901234567890',
            tokenId: '1',
            timestamp: Date.now(),
            txHash: '0x...',
            owner: '0x1234567890123456789012345678901234567890',
            eventType,
          })
        ).not.toThrow()
      }
    })
  })

  describe('CrossChainNFTTransferSchema', () => {
    it('validates cross-chain NFT transfer', () => {
      const transfer = {
        id: 'transfer-123',
        user: '0x1234567890123456789012345678901234567890',
        assetType: 'ERC721',
        sourceChainId: 1,
        destinationChainId: 10,
        collection: '0x2345678901234567890123456789012345678901',
        tokenId: '1234',
        amount: '1',
        recipient: '0x3456789012345678901234567890123456789012',
        mode: 'hyperlane',
        status: 'completed',
        createdAt: Date.now(),
        completedAt: Date.now(),
        sourceTxHash: '0xtx1...',
        destinationTxHash: '0xtx2...',
        messageId: '0xmsg...',
      }
      expect(() => CrossChainNFTTransferSchema.parse(transfer)).not.toThrow()
    })

    it('validates all transfer modes', () => {
      const modes = ['hyperlane', 'xlp', 'intent']
      for (const mode of modes) {
        expect(() =>
          CrossChainNFTTransferSchema.parse({
            id: 'test',
            user: '0x1234567890123456789012345678901234567890',
            assetType: 'ERC721',
            sourceChainId: 1,
            destinationChainId: 10,
            collection: '0x1234567890123456789012345678901234567890',
            tokenId: '1',
            amount: '1',
            recipient: '0x1234567890123456789012345678901234567890',
            mode,
            status: 'pending',
            createdAt: Date.now(),
          })
        ).not.toThrow()
      }
    })
  })

  describe('NFTCollectionInfoSchema', () => {
    it('validates NFT collection info', () => {
      const info = {
        address: '0x1234567890123456789012345678901234567890',
        chainId: 1,
        name: 'Cool Collection',
        symbol: 'COOL',
        assetType: 'ERC721',
        isHomeChain: true,
        royaltyReceiver: '0x2345678901234567890123456789012345678901',
        royaltyBps: 250,
        totalSupply: '10000',
        totalBridgedOut: 500,
        totalBridgedIn: 200,
      }
      expect(() => NFTCollectionInfoSchema.parse(info)).not.toThrow()
    })
  })

  describe('XLPNFTLiquiditySchema', () => {
    it('validates XLP NFT liquidity', () => {
      const liquidity = {
        xlp: '0x1234567890123456789012345678901234567890',
        wrappedCollections: [
          {
            sourceChainId: 1,
            sourceCollection: '0x2345678901234567890123456789012345678901',
            wrappedCollection: '0x3456789012345678901234567890123456789012',
            deployedAt: Date.now(),
          },
        ],
        totalNFTsBridged: 1000,
        totalFeesEarned: '5000000000000000000',
        successRate: 99.5,
        avgResponseTimeMs: 5000,
      }
      expect(() => XLPNFTLiquiditySchema.parse(liquidity)).not.toThrow()
    })
  })

  describe('NFTBridgeQuoteSchema', () => {
    it('validates NFT bridge quote', () => {
      const quote = {
        quoteId: 'quote-123',
        sourceChainId: 1,
        destinationChainId: 10,
        collection: '0x1234567890123456789012345678901234567890',
        tokenId: '1234',
        amount: '1',
        wrappedCollection: '0x2345678901234567890123456789012345678901',
        fee: '500000000000000',
        gasPayment: '100000000000000',
        totalCost: '600000000000000',
        estimatedTimeSeconds: 300,
        validUntil: Date.now() + 300000,
        route: 'xlp',
        xlp: '0x3456789012345678901234567890123456789012',
      }
      expect(() => NFTBridgeQuoteSchema.parse(quote)).not.toThrow()
    })
  })

  describe('NFTIntentOrderSchema', () => {
    it('validates NFT intent order', () => {
      const order = {
        orderId: 'order-123',
        user: '0x1234567890123456789012345678901234567890',
        nonce: '1',
        sourceChainId: 1,
        openDeadline: Date.now() + 3600000,
        fillDeadline: Date.now() + 86400000,
        assetType: 'ERC721',
        collection: '0x2345678901234567890123456789012345678901',
        tokenId: '1234',
        amount: '1',
        destinationChainId: 10,
        recipient: '0x3456789012345678901234567890123456789012',
        metadataHash: '0xmeta...',
        status: 'open',
      }
      expect(() => NFTIntentOrderSchema.parse(order)).not.toThrow()
    })
  })

  describe('NFTEILEventTypeSchema', () => {
    it('validates all event types', () => {
      const eventTypes = [
        'NFTVoucherRequested',
        'NFTVoucherIssued',
        'NFTVoucherFulfilled',
        'NFTVoucherExpired',
        'NFTRefunded',
        'SourceNFTClaimed',
        'NFTBridgeInitiated',
        'NFTBridgeReceived',
        'NFTWrapped',
        'NFTUnwrapped',
        'ProvenanceRecorded',
        'NFTOrderCreated',
        'NFTOrderClaimed',
        'NFTOrderSettled',
        'NFTOrderRefunded',
      ]
      for (const eventType of eventTypes) {
        expect(NFTEILEventTypeSchema.parse(eventType)).toBe(eventType)
      }
    })
  })

  describe('NFTEILConfigSchema', () => {
    it('validates NFT EIL config', () => {
      const config = {
        nftPaymasters: {
          '1': '0x1234567890123456789012345678901234567890',
          '10': '0x2345678901234567890123456789012345678901',
        },
        wrappedNFT: {
          '1': '0x3456789012345678901234567890123456789012',
          '10': '0x4567890123456789012345678901234567890123',
        },
        nftInputSettlers: {
          '1': '0x5678901234567890123456789012345678901234',
        },
        supportedCollections: {
          '1': [
            '0x1234567890123456789012345678901234567890',
            '0x2345678901234567890123456789012345678901',
          ],
        },
        requestTimeout: 3600,
        voucherTimeout: 7200,
        claimDelay: 60,
        minFee: '100000000000000',
        maxFee: '1000000000000000',
      }
      expect(() => NFTEILConfigSchema.parse(config)).not.toThrow()
    })
  })

  describe('NFTEILStatsSchema', () => {
    it('validates NFT EIL stats', () => {
      const stats = {
        totalNFTsBridged: 50000,
        totalUniqueCollections: 500,
        totalTransfers: 75000,
        totalFeesCollected: '100000000000000000000',
        erc721Bridged: 45000,
        erc1155Bridged: 5000,
        hyperlaneBridges: 40000,
        xlpBridges: 30000,
        intentBridges: 5000,
        avgBridgeTimeSeconds: 120,
        successRate: 99.8,
        last24hTransfers: 500,
        last24hFees: '1000000000000000000',
        lastUpdated: Date.now(),
      }
      expect(() => NFTEILStatsSchema.parse(stats)).not.toThrow()
    })
  })

  describe('NFTBridgeModeSchema', () => {
    it('validates all bridge modes', () => {
      const modes = ['hyperlane', 'xlp', 'intent']
      for (const mode of modes) {
        expect(NFTBridgeModeSchema.parse(mode)).toBe(mode)
      }
    })
  })

  describe('CrossChainNFTParamsSchema', () => {
    it('validates cross-chain NFT params', () => {
      const params = {
        assetType: 'ERC721',
        collection: '0x1234567890123456789012345678901234567890',
        tokenId: 1234n,
        amount: 1n,
        destinationChainId: 10,
        recipient: '0x2345678901234567890123456789012345678901',
        mode: 'hyperlane',
        maxFee: 1000000000000000n,
      }
      expect(() => CrossChainNFTParamsSchema.parse(params)).not.toThrow()
    })
  })

  describe('NFTBridgeResultSchema', () => {
    it('validates NFT bridge result', () => {
      const result = {
        txHash: '0xtx...',
        requestId: 'request-123',
        messageId: 'msg-123',
        orderId: 'order-123',
        estimatedArrival: Date.now() + 300000,
      }
      expect(() => NFTBridgeResultSchema.parse(result)).not.toThrow()
    })
  })

  describe('WrappedNFTDetailsSchema', () => {
    it('validates wrapped NFT details', () => {
      const details = {
        isWrapped: true,
        homeChainId: 1,
        originalCollection: '0x1234567890123456789012345678901234567890',
        originalTokenId: 1234n,
        tokenURI: 'https://example.com/token/1234',
        provenance: [
          {
            chainId: 1,
            collection: '0x1234567890123456789012345678901234567890',
            tokenId: '1234',
            timestamp: Date.now(),
            txHash: '0x...',
            owner: '0x2345678901234567890123456789012345678901',
            eventType: 'mint',
          },
        ],
      }
      expect(() => WrappedNFTDetailsSchema.parse(details)).not.toThrow()
    })
  })
})

