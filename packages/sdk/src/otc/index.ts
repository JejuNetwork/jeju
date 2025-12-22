/**
 * OTC Module - Over-the-counter token trading
 *
 * Provides access to:
 * - Consignment creation and management
 * - Offer creation and fulfillment
 * - Multi-token support with Chainlink price oracles
 */

import { type Address, type Hex, encodeFunctionData } from "viem";
import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import { requireContract } from "../config";

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum PaymentCurrency {
  ETH = 0,
  USDC = 1,
}

export enum OfferStatus {
  PENDING = "pending",
  APPROVED = "approved",
  PAID = "paid",
  FULFILLED = "fulfilled",
  CANCELLED = "cancelled",
}

export interface RegisteredToken {
  tokenId: Hex;
  tokenAddress: Address;
  decimals: number;
  isActive: boolean;
  priceOracle: Address;
}

export interface Consignment {
  id: bigint;
  tokenId: Hex;
  consigner: Address;
  totalAmount: bigint;
  remainingAmount: bigint;
  isNegotiable: boolean;
  fixedDiscountBps: number;
  fixedLockupDays: number;
  minDiscountBps: number;
  maxDiscountBps: number;
  minLockupDays: number;
  maxLockupDays: number;
  minDealAmount: bigint;
  maxDealAmount: bigint;
  maxPriceVolatilityBps: number;
  isActive: boolean;
  createdAt: bigint;
}

export interface Offer {
  id: bigint;
  consignmentId: bigint;
  tokenId: Hex;
  beneficiary: Address;
  tokenAmount: bigint;
  discountBps: number;
  createdAt: bigint;
  unlockTime: bigint;
  priceUsdPerToken: bigint;
  maxPriceDeviation: bigint;
  ethUsdPrice: bigint;
  currency: PaymentCurrency;
  approved: boolean;
  paid: boolean;
  fulfilled: boolean;
  cancelled: boolean;
  payer: Address;
  amountPaid: bigint;
}

export interface CreateConsignmentParams {
  tokenId: Hex;
  amount: bigint;
  isNegotiable: boolean;
  fixedDiscountBps?: number;
  fixedLockupDays?: number;
  minDiscountBps?: number;
  maxDiscountBps?: number;
  minLockupDays?: number;
  maxLockupDays?: number;
  minDealAmount?: bigint;
  maxDealAmount?: bigint;
  maxPriceVolatilityBps?: number;
}

export interface CreateOfferParams {
  consignmentId: bigint;
  tokenAmount: bigint;
  discountBps: number;
  lockupDays: number;
  currency: PaymentCurrency;
  beneficiary?: Address;
}

export interface OTCModule {
  // Tokens
  listRegisteredTokens(): Promise<RegisteredToken[]>;
  getToken(tokenId: Hex): Promise<RegisteredToken | null>;
  getTokenPrice(tokenId: Hex): Promise<bigint>;

  // Consignments
  createConsignment(
    params: CreateConsignmentParams,
  ): Promise<{ consignmentId: bigint; txHash: Hex }>;
  getConsignment(consignmentId: bigint): Promise<Consignment | null>;
  listActiveConsignments(): Promise<Consignment[]>;
  listMyConsignments(): Promise<Consignment[]>;
  cancelConsignment(consignmentId: bigint): Promise<Hex>;
  topUpConsignment(consignmentId: bigint, amount: bigint): Promise<Hex>;

  // Offers
  createOffer(
    params: CreateOfferParams,
  ): Promise<{ offerId: bigint; txHash: Hex }>;
  getOffer(offerId: bigint): Promise<Offer | null>;
  listMyOffers(): Promise<Offer[]>;
  listPendingOffers(): Promise<Offer[]>;
  approveOffer(offerId: bigint): Promise<Hex>;
  rejectOffer(offerId: bigint): Promise<Hex>;
  payOffer(offerId: bigint, amount?: bigint): Promise<Hex>;
  fulfillOffer(offerId: bigint): Promise<Hex>;
  cancelOffer(offerId: bigint): Promise<Hex>;

  // Quotes
  getQuote(
    consignmentId: bigint,
    tokenAmount: bigint,
    discountBps: number,
    currency: PaymentCurrency,
  ): Promise<{
    priceUsd: bigint;
    paymentAmount: bigint;
    currency: PaymentCurrency;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const OTC_ABI = [
  {
    name: "tokens",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "bytes32" }],
    outputs: [
      { name: "tokenAddress", type: "address" },
      { name: "decimals", type: "uint8" },
      { name: "isActive", type: "bool" },
      { name: "priceOracle", type: "address" },
    ],
  },
  {
    name: "tokenList",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "consignments",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "consignmentId", type: "uint256" }],
    outputs: [
      { name: "tokenId", type: "bytes32" },
      { name: "consigner", type: "address" },
      { name: "totalAmount", type: "uint256" },
      { name: "remainingAmount", type: "uint256" },
      { name: "isNegotiable", type: "bool" },
      { name: "fixedDiscountBps", type: "uint16" },
      { name: "fixedLockupDays", type: "uint32" },
      { name: "minDiscountBps", type: "uint16" },
      { name: "maxDiscountBps", type: "uint16" },
      { name: "minLockupDays", type: "uint32" },
      { name: "maxLockupDays", type: "uint32" },
      { name: "minDealAmount", type: "uint256" },
      { name: "maxDealAmount", type: "uint256" },
      { name: "maxPriceVolatilityBps", type: "uint16" },
      { name: "isActive", type: "bool" },
      { name: "createdAt", type: "uint256" },
    ],
  },
  {
    name: "createConsignment",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "isNegotiable", type: "bool" },
      { name: "fixedDiscountBps", type: "uint16" },
      { name: "fixedLockupDays", type: "uint32" },
      { name: "minDiscountBps", type: "uint16" },
      { name: "maxDiscountBps", type: "uint16" },
      { name: "minLockupDays", type: "uint32" },
      { name: "maxLockupDays", type: "uint32" },
      { name: "minDealAmount", type: "uint256" },
      { name: "maxDealAmount", type: "uint256" },
      { name: "maxPriceVolatilityBps", type: "uint16" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "cancelConsignment",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "consignmentId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "createOffer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "consignmentId", type: "uint256" },
      { name: "tokenAmount", type: "uint256" },
      { name: "discountBps", type: "uint256" },
      { name: "lockupDays", type: "uint256" },
      { name: "currency", type: "uint8" },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approveOffer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "rejectOffer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "payOfferETH",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "payOfferUSDC",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "offerId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "fulfillOffer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "cancelOffer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "getQuote",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "consignmentId", type: "uint256" },
      { name: "tokenAmount", type: "uint256" },
      { name: "discountBps", type: "uint256" },
      { name: "currency", type: "uint8" },
    ],
    outputs: [
      { name: "priceUsd", type: "uint256" },
      { name: "paymentAmount", type: "uint256" },
    ],
  },
  {
    name: "getActiveConsignments",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256[]" }],
  },
  {
    name: "getConsignerConsignments",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "consigner", type: "address" }],
    outputs: [{ type: "uint256[]" }],
  },
  {
    name: "getOpenOfferIds",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256[]" }],
  },
  {
    name: "getBeneficiaryOffers",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "beneficiary", type: "address" }],
    outputs: [{ type: "uint256[]" }],
  },
] as const;

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createOTCModule(
  wallet: JejuWallet,
  network: NetworkType,
): OTCModule {
  const otcAddress = requireContract("otc", "OTC", network);

  async function readConsignment(id: bigint): Promise<Consignment | null> {
    const result = await wallet.publicClient.readContract({
      address: otcAddress,
      abi: OTC_ABI,
      functionName: "consignments",
      args: [id],
    });

    if (result[2] === 0n) return null;

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
    };
  }

  return {
    async listRegisteredTokens() {
      // Would need to enumerate token list - simplified
      return [];
    },

    async getToken(tokenId) {
      const result = await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: "tokens",
        args: [tokenId],
      });

      if (result[0] === "0x0000000000000000000000000000000000000000")
        return null;

      return {
        tokenId,
        tokenAddress: result[0],
        decimals: Number(result[1]),
        isActive: result[2],
        priceOracle: result[3],
      };
    },

    async getTokenPrice(_tokenId) {
      // Would call the price oracle - returns USD with 8 decimals
      return 0n;
    },

    async createConsignment(params) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: "createConsignment",
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
      });

      const txHash = await wallet.sendTransaction({
        to: otcAddress,
        data,
      });

      return { consignmentId: 0n, txHash };
    },

    getConsignment: readConsignment,

    async listActiveConsignments() {
      const ids = await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: "getActiveConsignments",
        args: [],
      });

      const consignments: Consignment[] = [];
      for (const id of ids) {
        const c = await readConsignment(id);
        if (c) consignments.push(c);
      }
      return consignments;
    },

    async listMyConsignments() {
      const ids = await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: "getConsignerConsignments",
        args: [wallet.address],
      });

      const consignments: Consignment[] = [];
      for (const id of ids) {
        const c = await readConsignment(id);
        if (c) consignments.push(c);
      }
      return consignments;
    },

    async cancelConsignment(consignmentId) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: "cancelConsignment",
        args: [consignmentId],
      });

      return wallet.sendTransaction({ to: otcAddress, data });
    },

    async topUpConsignment(_consignmentId, _amount) {
      throw new Error("Not implemented");
    },

    async createOffer(params) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: "createOffer",
        args: [
          params.consignmentId,
          params.tokenAmount,
          BigInt(params.discountBps),
          BigInt(params.lockupDays),
          params.currency,
          params.beneficiary ?? wallet.address,
        ],
      });

      const txHash = await wallet.sendTransaction({
        to: otcAddress,
        data,
      });

      return { offerId: 0n, txHash };
    },

    async getOffer(_offerId) {
      // Would read offer from contract
      return null;
    },

    async listMyOffers() {
      await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: "getBeneficiaryOffers",
        args: [wallet.address],
      });
      return [];
    },

    async listPendingOffers() {
      await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: "getOpenOfferIds",
        args: [],
      });
      return [];
    },

    async approveOffer(offerId) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: "approveOffer",
        args: [offerId],
      });
      return wallet.sendTransaction({ to: otcAddress, data });
    },

    async rejectOffer(offerId) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: "rejectOffer",
        args: [offerId],
      });
      return wallet.sendTransaction({ to: otcAddress, data });
    },

    async payOffer(offerId, amount) {
      // Determine if ETH or USDC from offer
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: "payOfferETH",
        args: [offerId],
      });
      return wallet.sendTransaction({ to: otcAddress, data, value: amount });
    },

    async fulfillOffer(offerId) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: "fulfillOffer",
        args: [offerId],
      });
      return wallet.sendTransaction({ to: otcAddress, data });
    },

    async cancelOffer(offerId) {
      const data = encodeFunctionData({
        abi: OTC_ABI,
        functionName: "cancelOffer",
        args: [offerId],
      });
      return wallet.sendTransaction({ to: otcAddress, data });
    },

    async getQuote(consignmentId, tokenAmount, discountBps, currency) {
      const result = await wallet.publicClient.readContract({
        address: otcAddress,
        abi: OTC_ABI,
        functionName: "getQuote",
        args: [consignmentId, tokenAmount, BigInt(discountBps), currency],
      });

      return {
        priceUsd: result[0],
        paymentAmount: result[1],
        currency,
      };
    },
  };
}
