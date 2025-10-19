/**
 * Blockchain Contract Client
 * 
 * Wrapper for interacting with Jeju Network smart contracts using viem.
 * Handles FeeDistributorV2 and AirdropManager contracts.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Contract ABIs (simplified - will need full ABIs from compiled contracts)
const FEE_DISTRIBUTOR_V2_ABI = [
  {
    type: "function",
    name: "submitMonthlySnapshot",
    inputs: [
      { name: "period", type: "uint256" },
      { name: "contributors", type: "address[]" },
      { name: "shares", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "finalizeSnapshot",
    inputs: [{ name: "period", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getSnapshot",
    inputs: [{ name: "period", type: "uint256" }],
    outputs: [
      { name: "totalPool", type: "uint256" },
      { name: "totalShares", type: "uint256" },
      { name: "contributorCount", type: "uint256" },
      { name: "claimedCount", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "finalized", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getContributorReward",
    inputs: [
      { name: "contributor", type: "address" },
      { name: "period", type: "uint256" },
    ],
    outputs: [
      { name: "reward", type: "uint256" },
      { name: "claimed", type: "bool" },
      { name: "finalized", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "claimContributorReward",
    inputs: [{ name: "period", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "contributorPoolBalance",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const AIRDROP_MANAGER_ABI = [
  {
    type: "function",
    name: "createAirdrop",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "period", type: "uint256" },
    ],
    outputs: [{ name: "airdropId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimAirdrop",
    inputs: [{ name: "airdropId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getClaimableAmount",
    inputs: [
      { name: "airdropId", type: "uint256" },
      { name: "contributor", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "hasClaimed", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAirdrop",
    inputs: [{ name: "airdropId", type: "uint256" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "token", type: "address" },
      { name: "totalAmount", type: "uint256" },
      { name: "claimedAmount", type: "uint256" },
      { name: "claimedCount", type: "uint256" },
      { name: "contributorCount", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "active", type: "bool" },
    ],
    stateMutability: "view",
  },
] as const;

/**
 * Configuration for blockchain client
 */
export interface BlockchainConfig {
  rpcUrl: string;
  chainId: number;
  feeDistributorAddress: Address;
  airdropManagerAddress: Address;
  privateKey?: string; // For oracle bot
}

/**
 * Blockchain client for interacting with reward contracts
 */
export class BlockchainClient {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null;
  private config: BlockchainConfig;

  constructor(config: BlockchainConfig) {
    this.config = config;

    // Create public client for reading
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });

    // Create wallet client if private key provided
    if (config.privateKey) {
      const account = privateKeyToAccount(config.privateKey as Hash);
      this.walletClient = createWalletClient({
        account,
        transport: http(config.rpcUrl),
      });
    } else {
      this.walletClient = null;
    }
  }

  // ============ FeeDistributorV2 Read Functions ============

  async getContributorPoolBalance(): Promise<bigint> {
    const balance = await this.publicClient.readContract({
      address: this.config.feeDistributorAddress,
      abi: FEE_DISTRIBUTOR_V2_ABI,
      functionName: "contributorPoolBalance",
    });
    return balance;
  }

  async getSnapshot(period: number): Promise<{
    totalPool: bigint;
    totalShares: bigint;
    contributorCount: bigint;
    claimedCount: bigint;
    timestamp: bigint;
    finalized: boolean;
  }> {
    const result = await this.publicClient.readContract({
      address: this.config.feeDistributorAddress,
      abi: FEE_DISTRIBUTOR_V2_ABI,
      functionName: "getSnapshot",
      args: [BigInt(period)],
    });

    return {
      totalPool: result[0],
      totalShares: result[1],
      contributorCount: result[2],
      claimedCount: result[3],
      timestamp: result[4],
      finalized: result[5],
    };
  }

  async getContributorReward(
    contributor: Address,
    period: number,
  ): Promise<{
    reward: bigint;
    claimed: boolean;
    finalized: boolean;
  }> {
    const result = await this.publicClient.readContract({
      address: this.config.feeDistributorAddress,
      abi: FEE_DISTRIBUTOR_V2_ABI,
      functionName: "getContributorReward",
      args: [contributor, BigInt(period)],
    });

    return {
      reward: result[0],
      claimed: result[1],
      finalized: result[2],
    };
  }

  // ============ FeeDistributorV2 Write Functions (Oracle) ============

  async submitMonthlySnapshot(
    period: number,
    contributors: Address[],
    shares: bigint[],
  ): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error("Wallet client not initialized - private key required");
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.feeDistributorAddress,
      abi: FEE_DISTRIBUTOR_V2_ABI,
      functionName: "submitMonthlySnapshot",
      args: [BigInt(period), contributors, shares],
      chain: null,
    });

    return hash;
  }

  async finalizeSnapshot(period: number): Promise<Hash> {
    if (!this.walletClient) {
      throw new Error("Wallet client not initialized - private key required");
    }

    const hash = await this.walletClient.writeContract({
      address: this.config.feeDistributorAddress,
      abi: FEE_DISTRIBUTOR_V2_ABI,
      functionName: "finalizeSnapshot",
      args: [BigInt(period)],
      chain: null,
    });

    return hash;
  }

  // ============ AirdropManager Read Functions ============

  async getAirdrop(airdropId: number): Promise<{
    creator: Address;
    token: Address;
    totalAmount: bigint;
    claimedAmount: bigint;
    claimedCount: bigint;
    contributorCount: bigint;
    createdAt: bigint;
    active: boolean;
  }> {
    const result = await this.publicClient.readContract({
      address: this.config.airdropManagerAddress,
      abi: AIRDROP_MANAGER_ABI,
      functionName: "getAirdrop",
      args: [BigInt(airdropId)],
    });

    return {
      creator: result[0],
      token: result[1],
      totalAmount: result[2],
      claimedAmount: result[3],
      claimedCount: result[4],
      contributorCount: result[5],
      createdAt: result[6],
      active: result[7],
    };
  }

  async getClaimableAmount(
    airdropId: number,
    contributor: Address,
  ): Promise<{
    amount: bigint;
    hasClaimed: boolean;
  }> {
    const result = await this.publicClient.readContract({
      address: this.config.airdropManagerAddress,
      abi: AIRDROP_MANAGER_ABI,
      functionName: "getClaimableAmount",
      args: [BigInt(airdropId), contributor],
    });

    return {
      amount: result[0],
      hasClaimed: result[1],
    };
  }

  // ============ Utility Functions ============

  /**
   * Wait for transaction confirmation
   */
  async waitForTransaction(hash: Hash, confirmations: number = 1): Promise<void> {
    await this.publicClient.waitForTransactionReceipt({
      hash,
      confirmations,
    });
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<bigint> {
    return await this.publicClient.getBlockNumber();
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(
    to: Address,
    data: `0x${string}`,
  ): Promise<bigint> {
    return await this.publicClient.estimateGas({
      to,
      data,
    });
  }
}

/**
 * Create blockchain client from environment variables
 */
export function createBlockchainClientFromEnv(): BlockchainClient {
  const rpcUrl = process.env.JEJU_RPC_URL || "http://localhost:8545";
  const chainId = parseInt(process.env.CHAIN_ID || "31337");
  const feeDistributorAddress = (process.env.FEE_DISTRIBUTOR_ADDRESS || "0x") as Address;
  const airdropManagerAddress = (process.env.AIRDROP_MANAGER_ADDRESS || "0x") as Address;
  const privateKey = process.env.ORACLE_PRIVATE_KEY;

  return new BlockchainClient({
    rpcUrl,
    chainId,
    feeDistributorAddress,
    airdropManagerAddress,
    privateKey,
  });
}

