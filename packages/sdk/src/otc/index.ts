/**
 * OTC Module - Over-the-counter token trading
 *
 * Provides access to:
 * - Consignment creation and management
 * - Offer creation and fulfillment
 * - Multi-token support with Chainlink price oracles
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex, parseAbiItem } from 'viem'
import { requireContract } from '../config'
import type { JejuWallet } from '../wallet'

// Event signatures for tracking
const TOKEN_REGISTERED_EVENT = parseAbiItem(
  'event TokenRegistered(bytes32 indexed tokenId, address tokenAddress, address priceOracle)',
)

// ═══════════════════════════════════════════════════════════════════════════
//                         TYPE GUARDS & HELPERS
// ═══════════════════════════════════════════════════════════════════════════

type TokenRegisteredEventArgs = {
  tokenId?: Hex
}

function hasTokenRegisteredArgs(
  args: TokenRegisteredEventArgs,
): args is { tokenId: Hex } {
  return args.tokenId !== undefined
}

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const PaymentCurrency = {
  ETH: 0,
  USDC: 1,
} as const
export type PaymentCurrency =
  (typeof PaymentCurrency)[keyof typeof PaymentCurrency]

export const OfferStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  PAID: 'paid',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled',
} as const
export type OfferStatus = (typeof OfferStatus)[keyof typeof OfferStatus]

export interface RegisteredToken {
  tokenId: Hex
  tokenAddress: Address
  decimals: number
  isActive: boolean
  priceOracle: Address
}

export interface Consignment {
  id: bigint
  tokenId: Hex
  consigner: Address
  totalAmount: bigint
  remainingAmount: bigint
  isNegotiable: boolean
  fixedDiscountBps: number
  fixedLockupDays: number
  minDiscountBps: number
  maxDiscountBps: number
  minLockupDays: number
  maxLockupDays: number
  minDealAmount: bigint
  maxDealAmount: bigint
  maxPriceVolatilityBps: number
  isActive: boolean
  createdAt: bigint
}

export interface Offer {
  id: bigint
  consignmentId: bigint
  tokenId: Hex
  beneficiary: Address
  tokenAmount: bigint
  discountBps: number
  createdAt: bigint
  unlockTime: bigint
  priceUsdPerToken: bigint
  maxPriceDeviation: bigint
  ethUsdPrice: bigint
  currency: PaymentCurrency
  approved: boolean
  paid: boolean
  fulfilled: boolean
  cancelled: boolean
  payer: Address
  amountPaid: bigint
}

export interface CreateConsignmentParams {
  tokenId: Hex
  amount: bigint
  isNegotiable: boolean
  fixedDiscountBps?: number
  fixedLockupDays?: number
  minDiscountBps?: number
  maxDiscountBps?: number
  minLockupDays?: number
  maxLockupDays?: number
  minDealAmount?: bigint
  maxDealAmount?: bigint
  maxPriceVolatilityBps?: number
}

export interface CreateOfferParams {
  consignmentId: bigint
  tokenAmount: bigint
  discountBps: number
  lockupDays: number
  currency: PaymentCurrency
  beneficiary?: Address
}

export interface OTCModule {
  // Tokens
  listRegisteredTokens(): Promise<RegisteredToken[]>
  getToken(tokenId: Hex): Promise<RegisteredToken | null>
  getTokenPrice(tokenId: Hex): Promise<bigint>

  // Consignments
  createConsignment(
    params: CreateConsignmentParams,
  ): Promise<{ consignmentId: bigint; txHash: Hex }>
  getConsignment(consignmentId: bigint): Promise<Consignment | null>
  listActiveConsignments(): Promise<Consignment[]>
  listMyConsignments(): Promise<Consignment[]>
  cancelConsignment(consignmentId: bigint): Promise<Hex>
  topUpConsignment(consignmentId: bigint, amount: bigint): Promise<Hex>

  // Offers
  createOffer(
    params: CreateOfferParams,
  ): Promise<{ offerId: bigint; txHash: Hex }>
  getOffer(offerId: bigint): Promise<Offer | null>
  listMyOffers(): Promise<Offer[]>
  listPendingOffers(): Promise<Offer[]>
  approveOffer(offerId: bigint): Promise<Hex>
  rejectOffer(offerId: bigint): Promise<Hex>
  payOffer(offerId: bigint, amount?: bigint): Promise<Hex>
  fulfillOffer(offerId: bigint): Promise<Hex>
  cancelOffer(offerId: bigint): Promise<Hex>

  // Quotes
  getQuote(
    consignmentId: bigint,
    tokenAmount: bigint,
    discountBps: number,
    currency: PaymentCurrency,
  ): Promise<{
    priceUsd: bigint
    paymentAmount: bigint
    currency: PaymentCurrency
  }>
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const OTC_ABI = [
  {
    name: 'tokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'bytes32' }],
    outputs: [
      { name: 'tokenAddress', type: 'address' },
      { name: 'decimals', type: 'uint8' },
      { name: 'isActive', type: 'bool' },
      { name: 'priceOracle', type: 'address' },
    ],
  },
  {
    name: 'tokenList',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'consignments',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'consignmentId', type: 'uint256' }],
    outputs: [
      { name: 'tokenId', type: 'bytes32' },
      { name: 'consigner', type: 'address' },
      { name: 'totalAmount', type: 'uint256' },
      { name: 'remainingAmount', type: 'uint256' },
      { name: 'isNegotiable', type: 'bool' },
      { name: 'fixedDiscountBps', type: 'uint16' },
      { name: 'fixedLockupDays', type: 'uint32' },
      { name: 'minDiscountBps', type: 'uint16' },
      { name: 'maxDiscountBps', type: 'uint16' },
      { name: 'minLockupDays', type: 'uint32' },
      { name: 'maxLockupDays', type: 'uint32' },
      { name: 'minDealAmount', type: 'uint256' },
      { name: 'maxDealAmount', type: 'uint256' },
      { name: 'maxPriceVolatilityBps', type: 'uint16' },
      { name: 'isActive', type: 'bool' },
      { name: 'createdAt', type: 'uint256' },
    ],
  },
  {
    name: 'createConsignment',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'isNegotiable', type: 'bool' },
      { name: 'fixedDiscountBps', type: 'uint16' },
      { name: 'fixedLockupDays', type: 'uint32' },
      { name: 'minDiscountBps', type: 'uint16' },
      { name: 'maxDiscountBps', type: 'uint16' },
      { name: 'minLockupDays', type: 'uint32' },
      { name: 'maxLockupDays', type: 'uint32' },
      { name: 'minDealAmount', type: 'uint256' },
      { name: 'maxDealAmount', type: 'uint256' },
      { name: 'maxPriceVolatilityBps', type: 'uint16' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'cancelConsignment',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'consignmentId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'createOffer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'consignmentId', type: 'uint256' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'discountBps', type: 'uint256' },
      { name: 'lockupDays', type: 'uint256' },
      { name: 'currency', type: 'uint8' },
      { name: 'beneficiary', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'approveOffer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'offerId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'rejectOffer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'offerId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'payOfferETH',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'offerId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'payOfferUSDC',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'offerId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'fulfillOffer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'offerId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'cancelOffer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'offerId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getQuote',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'consignmentId', type: 'uint256' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'discountBps', type: 'uint256' },
      { name: 'currency', type: 'uint8' },
    ],
    outputs: [
      { name: 'priceUsd', type: 'uint256' },
      { name: 'paymentAmount', type: 'uint256' },
    ],
  },
  {
    name: 'getActiveConsignments',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'getConsignerConsignments',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'consigner', type: 'address' }],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'getOpenOfferIds',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'getBeneficiaryOffers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'beneficiary', type: 'address' }],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'offers',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'offerId', type: 'uint256' }],
    outputs: [
      { name: 'consignmentId', type: 'uint256' },
      { name: 'tokenId', type: 'bytes32' },
      { name: 'beneficiary', type: 'address' },
      { name: 'tokenAmount', type: 'uint256' },
      { name: 'discountBps', type: 'uint16' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'unlockTime', type: 'uint256' },
      { name: 'priceUsdPerToken', type: 'uint256' },
      { name: 'maxPriceDeviation', type: 'uint256' },
      { name: 'ethUsdPrice', type: 'uint256' },
      { name: 'currency', type: 'uint8' },
      { name: 'approved', type: 'bool' },
      { name: 'paid', type: 'bool' },
      { name: 'fulfilled', type: 'bool' },
      { name: 'cancelled', type: 'bool' },
      { name: 'payer', type: 'address' },
      { name: 'amountPaid', type: 'uint256' },
    ],
  },
  {
    name: 'getTokenPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'tokenCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'topUpConsignment',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'consignmentId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createOTCModule(
  wallet: JejuWallet,
  network: NetworkType,
): OTCModule {
  const otcAddress = requireContract('otc', 'OTC', network)

  async function readConsignment(id: bigint): Promise<Consignment | null> {
    const result = await wallet.publicClient.readContract({
      address: otcAddress,
      abi: OTC_ABI,
      functionName: 'consignments',
      args: [id],
    })

    if (result[2] === 0n) return null

    return {
      id,
      tokenId: result[0],
      consigner: result[1],
      totalAmount: result[2],
      remainingAmount: result[3],
      isNegotiable: result[4],
      fixedDiscountBps: Number(result[5]),
      fixedLockupDays: Number(result[6]),
      minDiscountBps: Number(result[7]),
      maxDiscountBps: Number(result[8]),
      minLockupDays: Number(result[9]),
      maxLockupDays: Number(result[10]),
      minDealAmount: result[11],
      maxDealAmount: result[12],
      maxPriceVolatilityBps: Number(result[13]),
      isActive: result[14],
      createdAt: result[15],
    }
  }

  return {
    async listRegisteredTokens() {
      const tokens: RegisteredToken[] = []

      // Query TokenRegistered events to find all tokens
      const logs = await wallet.publicClient.getLogs({
        address: otcAddress,
        event: TOKEN_REGISTERED_EVENT,
        fromBlock: 'earliest',
        toBlock: 'latest',
      })

      for (const log of logs) {
        if (!hasTokenRegisteredArgs(log.args)) continue
        const token = await this.getToken(log.args.tokenId)
        if (token) {
          tokens.push(token)
        }
      }

      return tokens
    },

    async getToken(tokenId) {
      const result = await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: 'tokens',
        args: [tokenId],
      })

      if (result[0] === '0x0000000000000000000000000000000000000000')
        return null

      return {
        tokenId,
        tokenAddress: result[0],
        decimals: Number(result[1]),
        isActive: result[2],
        priceOracle: result[3],
      }
    },

    async getTokenPrice(tokenId) {
      return wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: 'getTokenPrice',
        args: [tokenId],
      })
    },

    async createConsignment(params) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: 'createConsignment',
        args: [
          params.tokenId,
          params.amount,
          params.isNegotiable,
          params.fixedDiscountBps ?? 0,
          params.fixedLockupDays ?? 0,
          params.minDiscountBps ?? 0,
          params.maxDiscountBps ?? 0,
          params.minLockupDays ?? 0,
          params.maxLockupDays ?? 0,
          params.minDealAmount ?? 0n,
          params.maxDealAmount ?? 0n,
          params.maxPriceVolatilityBps ?? 500,
        ],
      })

      const txHash = await wallet.sendTransaction({
        to: otcAddress,
        data,
      })

      return { consignmentId: 0n, txHash }
    },

    getConsignment: readConsignment,

    async listActiveConsignments() {
      const ids = await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: 'getActiveConsignments',
        args: [],
      })

      // Limit to prevent DoS from large arrays
      const MAX_CONSIGNMENTS = 100
      const consignments: Consignment[] = []
      const limitedIds = ids.slice(0, MAX_CONSIGNMENTS)
      for (const id of limitedIds) {
        const c = await readConsignment(id)
        if (c) consignments.push(c)
      }
      return consignments
    },

    async listMyConsignments() {
      const ids = await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: 'getConsignerConsignments',
        args: [wallet.address],
      })

      // Limit to prevent DoS from large arrays
      const MAX_CONSIGNMENTS = 100
      const consignments: Consignment[] = []
      const limitedIds = ids.slice(0, MAX_CONSIGNMENTS)
      for (const id of limitedIds) {
        const c = await readConsignment(id)
        if (c) consignments.push(c)
      }
      return consignments
    },

    async cancelConsignment(consignmentId) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: 'cancelConsignment',
        args: [consignmentId],
      })

      return wallet.sendTransaction({ to: otcAddress, data })
    },

    async topUpConsignment(consignmentId, amount) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: 'topUpConsignment',
        args: [consignmentId, amount],
      })
      return wallet.sendTransaction({ to: otcAddress, data })
    },

    async createOffer(params) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: 'createOffer',
        args: [
          params.consignmentId,
          params.tokenAmount,
          BigInt(params.discountBps),
          BigInt(params.lockupDays),
          params.currency,
          params.beneficiary ?? wallet.address,
        ],
      })

      const txHash = await wallet.sendTransaction({
        to: otcAddress,
        data,
      })

      return { offerId: 0n, txHash }
    },

    async getOffer(offerId) {
      const result = await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: 'offers',
        args: [offerId],
      })

      // Check if offer exists (created at would be 0)
      if (result[5] === 0n) return null

      return {
        id: offerId,
        consignmentId: result[0],
        tokenId: result[1],
        beneficiary: result[2],
        tokenAmount: result[3],
        discountBps: Number(result[4]),
        createdAt: result[5],
        unlockTime: result[6],
        priceUsdPerToken: result[7],
        maxPriceDeviation: result[8],
        ethUsdPrice: result[9],
        currency: result[10] as PaymentCurrency,
        approved: result[11],
        paid: result[12],
        fulfilled: result[13],
        cancelled: result[14],
        payer: result[15],
        amountPaid: result[16],
      }
    },

    async listMyOffers() {
      const offerIds = await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: 'getBeneficiaryOffers',
        args: [wallet.address],
      })

      const MAX_OFFERS = 100
      const offers: Offer[] = []
      const limitedIds = offerIds.slice(0, MAX_OFFERS)

      for (const id of limitedIds) {
        const offer = await this.getOffer(id)
        if (offer) offers.push(offer)
      }

      return offers
    },

    async listPendingOffers() {
      const offerIds = await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: 'getOpenOfferIds',
        args: [],
      })

      const MAX_OFFERS = 100
      const offers: Offer[] = []
      const limitedIds = offerIds.slice(0, MAX_OFFERS)

      for (const id of limitedIds) {
        const offer = await this.getOffer(id)
        if (offer && !offer.cancelled && !offer.fulfilled) {
          offers.push(offer)
        }
      }

      return offers
    },

    async approveOffer(offerId) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: 'approveOffer',
        args: [offerId],
      })
      return wallet.sendTransaction({ to: otcAddress, data })
    },

    async rejectOffer(offerId) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: 'rejectOffer',
        args: [offerId],
      })
      return wallet.sendTransaction({ to: otcAddress, data })
    },

    async payOffer(offerId, amount) {
      // Determine if ETH or USDC from offer
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: 'payOfferETH',
        args: [offerId],
      })
      return wallet.sendTransaction({ to: otcAddress, data, value: amount })
    },

    async fulfillOffer(offerId) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: 'fulfillOffer',
        args: [offerId],
      })
      return wallet.sendTransaction({ to: otcAddress, data })
    },

    async cancelOffer(offerId) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: 'cancelOffer',
        args: [offerId],
      })
      return wallet.sendTransaction({ to: otcAddress, data })
    },

    async getQuote(consignmentId, tokenAmount, discountBps, currency) {
      const result = await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: 'getQuote',
        args: [consignmentId, tokenAmount, BigInt(discountBps), currency],
      })

      return {
        priceUsd: result[0],
        paymentAmount: result[1],
        currency,
      }
    },
  }
}
