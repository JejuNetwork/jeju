/**
 * Staking Module - JEJU token staking, rewards, and node staking
 *
 * This module provides access to:
 * - JEJU token staking for network rewards
 * - Node staking for validators/sequencers
 * - RPC provider staking
 * - Auto-slashing monitoring
 */

import { type Address, type Hex, encodeFunctionData, parseEther } from "viem";
import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import { getContract as getContractAddress, getServicesConfig } from "../config";

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export enum StakingTier {
  NONE = 0,
  BRONZE = 1,
  SILVER = 2,
  GOLD = 3,
  PLATINUM = 4,
}

export enum NodeType {
  VALIDATOR = 0,
  SEQUENCER = 1,
  RPC_PROVIDER = 2,
  STORAGE_PROVIDER = 3,
  COMPUTE_PROVIDER = 4,
}

export interface StakeInfo {
  staker: Address;
  amount: bigint;
  tier: StakingTier;
  stakedAt: bigint;
  lastRewardClaim: bigint;
  pendingRewards: bigint;
  isActive: boolean;
}

export interface NodeStakeInfo {
  operator: Address;
  nodeType: NodeType;
  stake: bigint;
  minStake: bigint;
  isActive: boolean;
  registeredAt: bigint;
  lastActivityAt: bigint;
  uptime: bigint;
  slashCount: number;
}

export interface RPCProviderInfo {
  operator: Address;
  endpoint: string;
  stake: bigint;
  isActive: boolean;
  registeredAt: bigint;
  requestCount: bigint;
  avgResponseTime: bigint;
  uptime: bigint;
}

export interface StakingStats {
  totalStaked: bigint;
  totalStakers: number;
  currentAPY: number;
  tierThresholds: Record<StakingTier, bigint>;
}

export interface StakingModule {
  // ═══════════════════════════════════════════════════════════════════════
  //                         TOKEN STAKING
  // ═══════════════════════════════════════════════════════════════════════

  /** Stake JEJU tokens */
  stake(amount: bigint): Promise<Hex>;

  /** Unstake JEJU tokens */
  unstake(amount: bigint): Promise<Hex>;

  /** Claim accumulated rewards */
  claimRewards(): Promise<Hex>;

  /** Get my staking info */
  getMyStake(): Promise<StakeInfo | null>;

  /** Get staking info for any address */
  getStake(address: Address): Promise<StakeInfo | null>;

  /** Get current tier for address */
  getTier(address?: Address): Promise<StakingTier>;

  /** Get pending rewards */
  getPendingRewards(address?: Address): Promise<bigint>;

  /** Get staking statistics */
  getStats(): Promise<StakingStats>;

  // ═══════════════════════════════════════════════════════════════════════
  //                         NODE STAKING
  // ═══════════════════════════════════════════════════════════════════════

  /** Register as a node operator */
  registerNode(nodeType: NodeType, metadata: string, stake: bigint): Promise<Hex>;

  /** Add stake to an existing node */
  addNodeStake(amount: bigint): Promise<Hex>;

  /** Withdraw stake from node (with unbonding) */
  withdrawNodeStake(amount: bigint): Promise<Hex>;

  /** Deactivate node (stop receiving work) */
  deactivateNode(): Promise<Hex>;

  /** Reactivate node */
  reactivateNode(): Promise<Hex>;

  /** Get my node stake info */
  getMyNodeStake(): Promise<NodeStakeInfo | null>;

  /** List active nodes by type */
  listNodes(nodeType: NodeType): Promise<NodeStakeInfo[]>;

  /** Get minimum stake required for node type */
  getMinNodeStake(nodeType: NodeType): Promise<bigint>;

  // ═══════════════════════════════════════════════════════════════════════
  //                         RPC PROVIDER STAKING
  // ═══════════════════════════════════════════════════════════════════════

  /** Register as RPC provider */
  registerRPCProvider(endpoint: string, stake: bigint): Promise<Hex>;

  /** Update RPC endpoint */
  updateRPCEndpoint(endpoint: string): Promise<Hex>;

  /** Add stake to RPC provider */
  addRPCStake(amount: bigint): Promise<Hex>;

  /** Withdraw RPC stake */
  withdrawRPCStake(amount: bigint): Promise<Hex>;

  /** Deactivate RPC provider */
  deactivateRPCProvider(): Promise<Hex>;

  /** Get RPC provider info */
  getRPCProvider(operator: Address): Promise<RPCProviderInfo | null>;

  /** List active RPC providers */
  listRPCProviders(): Promise<RPCProviderInfo[]>;

  /** Get best RPC provider (for client use) */
  getBestRPCEndpoint(): Promise<string>;

  // ═══════════════════════════════════════════════════════════════════════
  //                              CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════

  /** Minimum stake for token staking */
  readonly MIN_STAKE: bigint;

  /** Unbonding period in seconds */
  readonly UNBONDING_PERIOD: bigint;
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const STAKING_ABI = [
  {
    name: "stake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "unstake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "claimRewards",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "getStakeInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "staker", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "staker", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "tier", type: "uint8" },
          { name: "stakedAt", type: "uint256" },
          { name: "lastRewardClaim", type: "uint256" },
          { name: "pendingRewards", type: "uint256" },
          { name: "isActive", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "getTier",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "getPendingRewards",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "totalStaked",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "MIN_STAKE",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "UNBONDING_PERIOD",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const NODE_STAKING_ABI = [
  {
    name: "registerNode",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "nodeType", type: "uint8" },
      { name: "metadata", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "addStake",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "withdrawStake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "deactivate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "reactivate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "getNodeInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "operator", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "operator", type: "address" },
          { name: "nodeType", type: "uint8" },
          { name: "stake", type: "uint256" },
          { name: "minStake", type: "uint256" },
          { name: "isActive", type: "bool" },
          { name: "registeredAt", type: "uint256" },
          { name: "lastActivityAt", type: "uint256" },
          { name: "uptime", type: "uint256" },
          { name: "slashCount", type: "uint8" },
        ],
      },
    ],
  },
  {
    name: "getMinStake",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "nodeType", type: "uint8" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const RPC_PROVIDER_ABI = [
  {
    name: "registerProvider",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "endpoint", type: "string" }],
    outputs: [],
  },
  {
    name: "updateEndpoint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "endpoint", type: "string" }],
    outputs: [],
  },
  {
    name: "addStake",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "withdrawStake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "deactivate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "getProvider",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "operator", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "operator", type: "address" },
          { name: "endpoint", type: "string" },
          { name: "stake", type: "uint256" },
          { name: "isActive", type: "bool" },
          { name: "registeredAt", type: "uint256" },
          { name: "requestCount", type: "uint256" },
          { name: "avgResponseTime", type: "uint256" },
          { name: "uptime", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getActiveProviders",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    name: "getBestProvider",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createStakingModule(
  wallet: JejuWallet,
  network: NetworkType,
): StakingModule {
  const services = getServicesConfig(network);

  // Helper to safely get contract addresses
  const tryGetContract = (category: string, name: string): Address => {
    try {
      // Use category-name pattern
      return getContractAddress(category as "staking" | "rpc" | "governance" | "registry" | "defi" | "identity" | "moderation" | "games" | "containers" | "launchpad" | "nfts" | "payments" | "compute" | "storage", name, network) as Address;
    } catch {
      return "0x0000000000000000000000000000000000000000" as Address;
    }
  };

  const stakingAddress = tryGetContract("staking", "Staking");
  const nodeStakingAddress = tryGetContract("staking", "NodeStakingManager");
  const rpcProviderAddress = tryGetContract("rpc", "RPCProviderRegistry");

  const MIN_STAKE = parseEther("100"); // 100 JEJU
  const UNBONDING_PERIOD = 604800n; // 7 days

  return {
    MIN_STAKE,
    UNBONDING_PERIOD,

    // ═══════════════════════════════════════════════════════════════════════
    //                         TOKEN STAKING
    // ═══════════════════════════════════════════════════════════════════════

    async stake(amount) {
      const data = encodeFunctionData({
        abi: STAKING_ABI,
        functionName: "stake",
        args: [amount],
      });

      return wallet.sendTransaction({
        to: stakingAddress,
        data,
      });
    },

    async unstake(amount) {
      const data = encodeFunctionData({
        abi: STAKING_ABI,
        functionName: "unstake",
        args: [amount],
      });

      return wallet.sendTransaction({
        to: stakingAddress,
        data,
      });
    },

    async claimRewards() {
      const data = encodeFunctionData({
        abi: STAKING_ABI,
        functionName: "claimRewards",
        args: [],
      });

      return wallet.sendTransaction({
        to: stakingAddress,
        data,
      });
    },

    async getMyStake() {
      return this.getStake(wallet.address);
    },

    async getStake(address) {
      const result = await wallet.publicClient.readContract({
        address: stakingAddress,
        abi: STAKING_ABI,
        functionName: "getStakeInfo",
        args: [address],
      });

      if (!result || result.amount === 0n) return null;

      return {
        staker: result.staker,
        amount: result.amount,
        tier: result.tier as StakingTier,
        stakedAt: result.stakedAt,
        lastRewardClaim: result.lastRewardClaim,
        pendingRewards: result.pendingRewards,
        isActive: result.isActive,
      };
    },

    async getTier(address) {
      const result = await wallet.publicClient.readContract({
        address: stakingAddress,
        abi: STAKING_ABI,
        functionName: "getTier",
        args: [address ?? wallet.address],
      });

      return result as StakingTier;
    },

    async getPendingRewards(address) {
      return wallet.publicClient.readContract({
        address: stakingAddress,
        abi: STAKING_ABI,
        functionName: "getPendingRewards",
        args: [address ?? wallet.address],
      });
    },

    async getStats() {
      const totalStaked = await wallet.publicClient.readContract({
        address: stakingAddress,
        abi: STAKING_ABI,
        functionName: "totalStaked",
        args: [],
      });

      // Fetch from API for more stats
      const response = await fetch(`${services.gateway.api}/staking/stats`).catch(() => null);
      const data = response?.ok ? await response.json() : null;

      return {
        totalStaked,
        totalStakers: data?.totalStakers ?? 0,
        currentAPY: data?.currentAPY ?? 0,
        tierThresholds: {
          [StakingTier.NONE]: 0n,
          [StakingTier.BRONZE]: parseEther("100"),
          [StakingTier.SILVER]: parseEther("1000"),
          [StakingTier.GOLD]: parseEther("10000"),
          [StakingTier.PLATINUM]: parseEther("100000"),
        },
      };
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                         NODE STAKING
    // ═══════════════════════════════════════════════════════════════════════

    async registerNode(nodeType, metadata, stake) {
      const data = encodeFunctionData({
        abi: NODE_STAKING_ABI,
        functionName: "registerNode",
        args: [nodeType, metadata],
      });

      return wallet.sendTransaction({
        to: nodeStakingAddress,
        data,
        value: stake,
      });
    },

    async addNodeStake(amount) {
      const data = encodeFunctionData({
        abi: NODE_STAKING_ABI,
        functionName: "addStake",
        args: [],
      });

      return wallet.sendTransaction({
        to: nodeStakingAddress,
        data,
        value: amount,
      });
    },

    async withdrawNodeStake(amount) {
      const data = encodeFunctionData({
        abi: NODE_STAKING_ABI,
        functionName: "withdrawStake",
        args: [amount],
      });

      return wallet.sendTransaction({
        to: nodeStakingAddress,
        data,
      });
    },

    async deactivateNode() {
      const data = encodeFunctionData({
        abi: NODE_STAKING_ABI,
        functionName: "deactivate",
        args: [],
      });

      return wallet.sendTransaction({
        to: nodeStakingAddress,
        data,
      });
    },

    async reactivateNode() {
      const data = encodeFunctionData({
        abi: NODE_STAKING_ABI,
        functionName: "reactivate",
        args: [],
      });

      return wallet.sendTransaction({
        to: nodeStakingAddress,
        data,
      });
    },

    async getMyNodeStake() {
      const result = await wallet.publicClient.readContract({
        address: nodeStakingAddress,
        abi: NODE_STAKING_ABI,
        functionName: "getNodeInfo",
        args: [wallet.address],
      });

      if (!result || result.stake === 0n) return null;

      return {
        operator: result.operator,
        nodeType: result.nodeType as NodeType,
        stake: result.stake,
        minStake: result.minStake,
        isActive: result.isActive,
        registeredAt: result.registeredAt,
        lastActivityAt: result.lastActivityAt,
        uptime: result.uptime,
        slashCount: Number(result.slashCount),
      };
    },

    async listNodes(nodeType) {
      // Fetch from API
      const response = await fetch(
        `${services.gateway.api}/staking/nodes?type=${nodeType}`
      );
      if (!response.ok) return [];
      const data = await response.json();
      return data.nodes ?? [];
    },

    async getMinNodeStake(nodeType) {
      return wallet.publicClient.readContract({
        address: nodeStakingAddress,
        abi: NODE_STAKING_ABI,
        functionName: "getMinStake",
        args: [nodeType],
      });
    },

    // ═══════════════════════════════════════════════════════════════════════
    //                         RPC PROVIDER STAKING
    // ═══════════════════════════════════════════════════════════════════════

    async registerRPCProvider(endpoint, stake) {
      const data = encodeFunctionData({
        abi: RPC_PROVIDER_ABI,
        functionName: "registerProvider",
        args: [endpoint],
      });

      return wallet.sendTransaction({
        to: rpcProviderAddress,
        data,
        value: stake,
      });
    },

    async updateRPCEndpoint(endpoint) {
      const data = encodeFunctionData({
        abi: RPC_PROVIDER_ABI,
        functionName: "updateEndpoint",
        args: [endpoint],
      });

      return wallet.sendTransaction({
        to: rpcProviderAddress,
        data,
      });
    },

    async addRPCStake(amount) {
      const data = encodeFunctionData({
        abi: RPC_PROVIDER_ABI,
        functionName: "addStake",
        args: [],
      });

      return wallet.sendTransaction({
        to: rpcProviderAddress,
        data,
        value: amount,
      });
    },

    async withdrawRPCStake(amount) {
      const data = encodeFunctionData({
        abi: RPC_PROVIDER_ABI,
        functionName: "withdrawStake",
        args: [amount],
      });

      return wallet.sendTransaction({
        to: rpcProviderAddress,
        data,
      });
    },

    async deactivateRPCProvider() {
      const data = encodeFunctionData({
        abi: RPC_PROVIDER_ABI,
        functionName: "deactivate",
        args: [],
      });

      return wallet.sendTransaction({
        to: rpcProviderAddress,
        data,
      });
    },

    async getRPCProvider(operator) {
      const result = await wallet.publicClient.readContract({
        address: rpcProviderAddress,
        abi: RPC_PROVIDER_ABI,
        functionName: "getProvider",
        args: [operator],
      });

      if (!result || result.stake === 0n) return null;

      return {
        operator: result.operator,
        endpoint: result.endpoint,
        stake: result.stake,
        isActive: result.isActive,
        registeredAt: result.registeredAt,
        requestCount: result.requestCount,
        avgResponseTime: result.avgResponseTime,
        uptime: result.uptime,
      };
    },

    async listRPCProviders() {
      const addresses = await wallet.publicClient.readContract({
        address: rpcProviderAddress,
        abi: RPC_PROVIDER_ABI,
        functionName: "getActiveProviders",
        args: [],
      });

      const providers: RPCProviderInfo[] = [];
      for (const addr of addresses) {
        const info = await this.getRPCProvider(addr);
        if (info) providers.push(info);
      }

      return providers;
    },

    async getBestRPCEndpoint() {
      return wallet.publicClient.readContract({
        address: rpcProviderAddress,
        abi: RPC_PROVIDER_ABI,
        functionName: "getBestProvider",
        args: [],
      });
    },
  };
}

