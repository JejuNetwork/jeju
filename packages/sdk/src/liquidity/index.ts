/**
 * Liquidity Module - Risk-based liquidity allocation and routing
 *
 * This module provides access to:
 * - RiskSleeve: Tiered liquidity with risk-based allocation
 * - LiquidityRouter: Single entry point for multi-pool deposits
 * - Cross-pool yield tracking
 */

import { type Address, type Hex, encodeFunctionData, parseEther } from "viem";
import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import { getServicesConfig } from "../config";

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum RiskTier {
  CONSERVATIVE = 0,
  BALANCED = 1,
  AGGRESSIVE = 2,
}

export interface SleeveStats {
  deposited: bigint;
  utilized: bigint;
  available: bigint;
  utilizationBps: bigint;
  yieldBps: bigint;
}

export interface UserSleevePosition {
  deposited: bigint;
  pendingYield: bigint;
  depositDuration: bigint;
}

export interface AllocationStrategy {
  ethVaultBps: bigint;
  tokenVaultBps: bigint;
  nodeStakeBps: bigint;
  xlpStakeBps: bigint;
  paymasterStakeBps: bigint;
  governanceStakeBps: bigint;
}

export interface RouterPosition {
  ethVaultShares: bigint;
  tokenVaultShares: bigint;
  stakedAmount: bigint;
  pendingRewards: bigint;
  strategy: AllocationStrategy;
}

export interface LiquidityModule {
  // ═══════════════════════════════════════════════════════════════════════
  //                         RISK SLEEVE
  // ═══════════════════════════════════════════════════════════════════════

  /** Deposit ETH into a risk sleeve */
  depositToSleeve(tier: RiskTier, amount: bigint): Promise<Hex>;

  /** Withdraw from a risk sleeve */
  withdrawFromSleeve(tier: RiskTier, amount: bigint): Promise<Hex>;

  /** Claim yield from a sleeve */
  claimSleeveYield(tier: RiskTier): Promise<Hex>;

  /** Get sleeve statistics */
  getSleeveStats(tier: RiskTier): Promise<SleeveStats>;

  /** Get user's position in a sleeve */
  getSleevePosition(tier: RiskTier, address?: Address): Promise<UserSleevePosition>;

  /** Get token risk score */
  getTokenRiskScore(token: Address): Promise<number>;

  // ═══════════════════════════════════════════════════════════════════════
  //                         LIQUIDITY ROUTER
  // ═══════════════════════════════════════════════════════════════════════

  /** Deposit ETH via the router (auto-allocates based on strategy) */
  depositETH(amount: bigint): Promise<Hex>;

  /** Deposit tokens via the router (auto-allocates based on strategy) */
  depositToken(amount: bigint): Promise<Hex>;

  /** Set custom allocation strategy */
  setStrategy(strategy: AllocationStrategy): Promise<Hex>;

  /** Reset to default strategy */
  resetStrategy(): Promise<Hex>;

  /** Get user's router position */
  getRouterPosition(address?: Address): Promise<RouterPosition>;

  /** Estimate yearly yield */
  estimateYield(address?: Address): Promise<number>;

  /** Get default strategy */
  getDefaultStrategy(): Promise<AllocationStrategy>;

  // ═══════════════════════════════════════════════════════════════════════
  //                              CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════

  readonly RISK_TIERS: typeof RiskTier;
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const RISK_SLEEVE_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "tier", type: "uint8" }],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tier", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "claimYield",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "tier", type: "uint8" }],
    outputs: [],
  },
  {
    name: "getSleeveStats",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tier", type: "uint8" }],
    outputs: [
      { name: "deposited", type: "uint256" },
      { name: "utilized", type: "uint256" },
      { name: "available", type: "uint256" },
      { name: "utilizationBps", type: "uint256" },
      { name: "yieldBps", type: "uint256" },
    ],
  },
  {
    name: "getUserPosition",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "tier", type: "uint8" },
    ],
    outputs: [
      { name: "deposited", type: "uint256" },
      { name: "pendingYield", type: "uint256" },
      { name: "depositDuration", type: "uint256" },
    ],
  },
  {
    name: "tokenRiskScores",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const LIQUIDITY_ROUTER_ABI = [
  {
    name: "depositETH",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "depositToken",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "setStrategy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "strategy",
        type: "tuple",
        components: [
          { name: "ethVaultBps", type: "uint256" },
          { name: "tokenVaultBps", type: "uint256" },
          { name: "nodeStakeBps", type: "uint256" },
          { name: "xlpStakeBps", type: "uint256" },
          { name: "paymasterStakeBps", type: "uint256" },
          { name: "governanceStakeBps", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "resetToDefaultStrategy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "getPosition",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "ethVaultShares", type: "uint256" },
      { name: "tokenVaultShares", type: "uint256" },
      { name: "stakedAmount", type: "uint256" },
      { name: "pendingRewards", type: "uint256" },
      {
        name: "strategy",
        type: "tuple",
        components: [
          { name: "ethVaultBps", type: "uint256" },
          { name: "tokenVaultBps", type: "uint256" },
          { name: "nodeStakeBps", type: "uint256" },
          { name: "xlpStakeBps", type: "uint256" },
          { name: "paymasterStakeBps", type: "uint256" },
          { name: "governanceStakeBps", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "estimateYield",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "defaultStrategy",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "ethVaultBps", type: "uint256" },
          { name: "tokenVaultBps", type: "uint256" },
          { name: "nodeStakeBps", type: "uint256" },
          { name: "xlpStakeBps", type: "uint256" },
          { name: "paymasterStakeBps", type: "uint256" },
          { name: "governanceStakeBps", type: "uint256" },
        ],
      },
    ],
  },
] as const;

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createLiquidityModule(
  wallet: JejuWallet,
  network: NetworkType,
): LiquidityModule {
  // Contract addresses - these would come from config
  const riskSleeveAddress = "0x0000000000000000000000000000000000000000" as Address; // TODO: Add to deployment
  const liquidityRouterAddress = "0x0000000000000000000000000000000000000000" as Address; // TODO: Add to deployment

  return {
    RISK_TIERS: RiskTier,

    // ═══════════════════════════════════════════════════════════════════════
    //                         RISK SLEEVE
    // ═══════════════════════════════════════════════════════════════════════

    async depositToSleeve(tier, amount) {
      const data = encodeFunctionData({
        abi: RISK_SLEEVE_ABI,
        functionName: "deposit",
        args: [tier],
      });

      return wallet.sendTransaction({
        to: riskSleeveAddress,
        data,
        value: amount,
      });
    },

    async withdrawFromSleeve(tier, amount) {
      const data = encodeFunctionData({
        abi: RISK_SLEEVE_ABI,
        functionName: "withdraw",
        args: [tier, amount],
      });

      return wallet.sendTransaction({
        to: riskSleeveAddress,
        data,
      });
    },

    async claimSleeveYield(tier) {
      const data = encodeFunctionData({
        abi: RISK_SLEEVE_ABI,
        functionName: "claimYield",
        args: [tier],
      });

      return wallet.sendTransaction({
        to: riskSleeveAddress,
        data,
      });
    },

    async getSleeveStats(tier) {
      const result = await wallet.publicClient.readContract({
        address: riskSleeveAddress,
        abi: RISK_SLEEVE_ABI,
        functionName: "getSleeveStats",
        args: [tier],
      });

      return {
        deposited: result[0],
        utilized: result[1],
        available: result[2],
        utilizationBps: result[3],
        yieldBps: result[4],
      };
    },

    async getSleevePosition(tier, address) {
      const result = await wallet.publicClient.readContract({
        address: riskSleeveAddress,
        abi: RISK_SLEEVE_ABI,
        functionName: "getUserPosition",
        args: [address ?? wallet.address, tier],
      });

      return {
        deposited: result[0],
        pendingYield: result[1],
        depositDuration: result[2],
      };
    },

    async getTokenRiskScore(token) {
      const result = await wallet.publicClient.readContract({
        address: riskSleeveAddress,
        abi: RISK_SLEEVE_ABI,
        functionName: "tokenRiskScores",
        args: [token],
      });

      return Number(result);
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                         LIQUIDITY ROUTER
    // ═══════════════════════════════════════════════════════════════════════

    async depositETH(amount) {
      const data = encodeFunctionData({
        abi: LIQUIDITY_ROUTER_ABI,
        functionName: "depositETH",
        args: [],
      });

      return wallet.sendTransaction({
        to: liquidityRouterAddress,
        data,
        value: amount,
      });
    },

    async depositToken(amount) {
      const data = encodeFunctionData({
        abi: LIQUIDITY_ROUTER_ABI,
        functionName: "depositToken",
        args: [amount],
      });

      return wallet.sendTransaction({
        to: liquidityRouterAddress,
        data,
      });
    },

    async setStrategy(strategy) {
      const data = encodeFunctionData({
        abi: LIQUIDITY_ROUTER_ABI,
        functionName: "setStrategy",
        args: [strategy],
      });

      return wallet.sendTransaction({
        to: liquidityRouterAddress,
        data,
      });
    },

    async resetStrategy() {
      const data = encodeFunctionData({
        abi: LIQUIDITY_ROUTER_ABI,
        functionName: "resetToDefaultStrategy",
        args: [],
      });

      return wallet.sendTransaction({
        to: liquidityRouterAddress,
        data,
      });
    },

    async getRouterPosition(address) {
      const result = await wallet.publicClient.readContract({
        address: liquidityRouterAddress,
        abi: LIQUIDITY_ROUTER_ABI,
        functionName: "getPosition",
        args: [address ?? wallet.address],
      });

      return {
        ethVaultShares: result[0],
        tokenVaultShares: result[1],
        stakedAmount: result[2],
        pendingRewards: result[3],
        strategy: {
          ethVaultBps: result[4].ethVaultBps,
          tokenVaultBps: result[4].tokenVaultBps,
          nodeStakeBps: result[4].nodeStakeBps,
          xlpStakeBps: result[4].xlpStakeBps,
          paymasterStakeBps: result[4].paymasterStakeBps,
          governanceStakeBps: result[4].governanceStakeBps,
        },
      };
    },

    async estimateYield(address) {
      const result = await wallet.publicClient.readContract({
        address: liquidityRouterAddress,
        abi: LIQUIDITY_ROUTER_ABI,
        functionName: "estimateYield",
        args: [address ?? wallet.address],
      });

      return Number(result) / 100; // Convert bps to percentage
    },

    async getDefaultStrategy() {
      const result = await wallet.publicClient.readContract({
        address: liquidityRouterAddress,
        abi: LIQUIDITY_ROUTER_ABI,
        functionName: "defaultStrategy",
        args: [],
      });

      return {
        ethVaultBps: result.ethVaultBps,
        tokenVaultBps: result.tokenVaultBps,
        nodeStakeBps: result.nodeStakeBps,
        xlpStakeBps: result.xlpStakeBps,
        paymasterStakeBps: result.paymasterStakeBps,
        governanceStakeBps: result.governanceStakeBps,
      };
    },
  };
}


