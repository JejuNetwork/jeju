/**
 * Messaging Module - Decentralized messaging relay network
 *
 * Provides access to:
 * - Message node registration and management
 * - Messaging key registry
 * - Node performance metrics
 */

import { type Address, type Hex, encodeFunctionData, parseEther } from "viem";
import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import { getContract as getContractAddress, getServicesConfig } from "../config";

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface MessageNode {
  nodeId: Hex;
  operator: Address;
  endpoint: string;
  region: string;
  stakedAmount: bigint;
  registeredAt: bigint;
  lastHeartbeat: bigint;
  messagesRelayed: bigint;
  feesEarned: bigint;
  isActive: boolean;
  isSlashed: boolean;
}

export interface NodePerformance {
  nodeId: Hex;
  uptimeScore: number; // 0-10000 (100.00%)
  deliveryRate: number; // 0-10000 (100.00%)
  avgLatencyMs: number;
  lastUpdated: bigint;
}

export interface MessagingKey {
  owner: Address;
  publicKey: Hex;
  algorithm: string;
  registeredAt: bigint;
  expiresAt: bigint;
  isActive: boolean;
}

export interface RegisterMessagingNodeParams {
  endpoint: string;
  region: string;
  stake: bigint;
}

export interface RegisterKeyParams {
  publicKey: Hex;
  algorithm?: string; // default: "x25519-xsalsa20-poly1305"
  expiresIn?: number; // seconds, 0 = never
}

export interface MessagingModule {
  // Node Registry
  registerNode(params: RegisterMessagingNodeParams): Promise<{ nodeId: Hex; txHash: Hex }>;
  getNode(nodeId: Hex): Promise<MessageNode | null>;
  getMyNodes(): Promise<MessageNode[]>;
  listActiveNodes(): Promise<MessageNode[]>;
  listNodesByRegion(region: string): Promise<MessageNode[]>;
  updateEndpoint(nodeId: Hex, endpoint: string): Promise<Hex>;
  addNodeStake(nodeId: Hex, amount: bigint): Promise<Hex>;
  withdrawNodeStake(nodeId: Hex, amount: bigint): Promise<Hex>;
  deactivateNode(nodeId: Hex): Promise<Hex>;
  heartbeat(nodeId: Hex): Promise<Hex>;

  // Performance
  getNodePerformance(nodeId: Hex): Promise<NodePerformance | null>;
  getBestNodes(count?: number): Promise<MessageNode[]>;

  // Key Registry
  registerKey(params: RegisterKeyParams): Promise<Hex>;
  getKey(owner: Address): Promise<MessagingKey | null>;
  getMyKey(): Promise<MessagingKey | null>;
  rotateKey(newPublicKey: Hex): Promise<Hex>;
  revokeKey(): Promise<Hex>;

  // Fees
  claimFees(nodeId: Hex): Promise<Hex>;
  getPendingFees(nodeId: Hex): Promise<bigint>;

  // Constants
  readonly MIN_STAKE: bigint;
  readonly BASE_FEE_PER_MESSAGE: bigint;
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const MESSAGE_NODE_REGISTRY_ABI = [
  {
    name: "registerNode",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "endpoint", type: "string" },
      { name: "region", type: "string" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "nodes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "nodeId", type: "bytes32" }],
    outputs: [
      { name: "nodeId", type: "bytes32" },
      { name: "operator", type: "address" },
      { name: "endpoint", type: "string" },
      { name: "region", type: "string" },
      { name: "stakedAmount", type: "uint256" },
      { name: "registeredAt", type: "uint256" },
      { name: "lastHeartbeat", type: "uint256" },
      { name: "messagesRelayed", type: "uint256" },
      { name: "feesEarned", type: "uint256" },
      { name: "isActive", type: "bool" },
      { name: "isSlashed", type: "bool" },
    ],
  },
  {
    name: "performance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "nodeId", type: "bytes32" }],
    outputs: [
      { name: "uptimeScore", type: "uint256" },
      { name: "deliveryRate", type: "uint256" },
      { name: "avgLatencyMs", type: "uint256" },
      { name: "lastUpdated", type: "uint256" },
    ],
  },
  {
    name: "operatorNodes",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "operator", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "activeNodeIds",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "nodesByRegion",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "region", type: "string" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "updateEndpoint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nodeId", type: "bytes32" },
      { name: "endpoint", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "addStake",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "nodeId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "withdrawStake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nodeId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "deactivateNode",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "nodeId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "heartbeat",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "nodeId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "claimFees",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "nodeId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "pendingFees",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "nodeId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "minStake",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "baseFeePerMessage",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const MESSAGING_KEY_REGISTRY_ABI = [
  {
    name: "registerKey",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "publicKey", type: "bytes" },
      { name: "algorithm", type: "string" },
      { name: "expiresAt", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "getKey",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      { name: "publicKey", type: "bytes" },
      { name: "algorithm", type: "string" },
      { name: "registeredAt", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "isActive", type: "bool" },
    ],
  },
  {
    name: "rotateKey",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newPublicKey", type: "bytes" }],
    outputs: [],
  },
  {
    name: "revokeKey",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createMessagingModule(
  wallet: JejuWallet,
  network: NetworkType,
): MessagingModule {
  const tryGetContract = (category: string, name: string): Address => {
    try {
      // @ts-expect-error - category names may vary by deployment
      return getContractAddress(category, name, network) as Address;
    } catch {
      return "0x0000000000000000000000000000000000000000" as Address;
    }
  };

  const nodeRegistryAddress = tryGetContract("messaging", "MessageNodeRegistry");
  const keyRegistryAddress = tryGetContract("messaging", "MessagingKeyRegistry");

  const MIN_STAKE = parseEther("1000");
  const BASE_FEE_PER_MESSAGE = parseEther("0.0001");

  async function readNode(nodeId: Hex): Promise<MessageNode | null> {
    const result = await wallet.publicClient.readContract({
      address: nodeRegistryAddress,
      abi: MESSAGE_NODE_REGISTRY_ABI,
      functionName: "nodes",
      args: [nodeId],
    });

    if (result[1] === "0x0000000000000000000000000000000000000000") return null;

    return {
      nodeId: result[0],
      operator: result[1],
      endpoint: result[2],
      region: result[3],
      stakedAmount: result[4],
      registeredAt: result[5],
      lastHeartbeat: result[6],
      messagesRelayed: result[7],
      feesEarned: result[8],
      isActive: result[9],
      isSlashed: result[10],
    };
  }

  return {
    MIN_STAKE,
    BASE_FEE_PER_MESSAGE,

    async registerNode(params) {
      const data = encodeFunctionData({
        abi: MESSAGE_NODE_REGISTRY_ABI,
        functionName: "registerNode",
        args: [params.endpoint, params.region],
      });

      const txHash = await wallet.sendTransaction({
        to: nodeRegistryAddress,
        data,
        value: params.stake,
      });

      const nodeId = `0x${Buffer.from(params.endpoint).toString("hex").padEnd(64, "0")}` as Hex;
      return { nodeId, txHash };
    },

    getNode: readNode,

    async getMyNodes() {
      // Would enumerate operatorNodes mapping
      return [];
    },

    async listActiveNodes() {
      // Would enumerate activeNodeIds array
      return [];
    },

    async listNodesByRegion(_region) {
      // Would enumerate nodesByRegion mapping
      return [];
    },

    async updateEndpoint(nodeId, endpoint) {
      const data = encodeFunctionData({
        abi: MESSAGE_NODE_REGISTRY_ABI,
        functionName: "updateEndpoint",
        args: [nodeId, endpoint],
      });
      return wallet.sendTransaction({ to: nodeRegistryAddress, data });
    },

    async addNodeStake(nodeId, amount) {
      const data = encodeFunctionData({
        abi: MESSAGE_NODE_REGISTRY_ABI,
        functionName: "addStake",
        args: [nodeId],
      });
      return wallet.sendTransaction({ to: nodeRegistryAddress, data, value: amount });
    },

    async withdrawNodeStake(nodeId, amount) {
      const data = encodeFunctionData({
        abi: MESSAGE_NODE_REGISTRY_ABI,
        functionName: "withdrawStake",
        args: [nodeId, amount],
      });
      return wallet.sendTransaction({ to: nodeRegistryAddress, data });
    },

    async deactivateNode(nodeId) {
      const data = encodeFunctionData({
        abi: MESSAGE_NODE_REGISTRY_ABI,
        functionName: "deactivateNode",
        args: [nodeId],
      });
      return wallet.sendTransaction({ to: nodeRegistryAddress, data });
    },

    async heartbeat(nodeId) {
      const data = encodeFunctionData({
        abi: MESSAGE_NODE_REGISTRY_ABI,
        functionName: "heartbeat",
        args: [nodeId],
      });
      return wallet.sendTransaction({ to: nodeRegistryAddress, data });
    },

    async getNodePerformance(nodeId) {
      const result = await wallet.publicClient.readContract({
        address: nodeRegistryAddress,
        abi: MESSAGE_NODE_REGISTRY_ABI,
        functionName: "performance",
        args: [nodeId],
      });

      return {
        nodeId,
        uptimeScore: Number(result[0]),
        deliveryRate: Number(result[1]),
        avgLatencyMs: Number(result[2]),
        lastUpdated: result[3],
      };
    },

    async getBestNodes(_count = 10) {
      // Would sort by performance metrics
      return [];
    },

    async registerKey(params) {
      const expiresAt = params.expiresIn
        ? BigInt(Math.floor(Date.now() / 1000) + params.expiresIn)
        : 0n;

      const data = encodeFunctionData({
        abi: MESSAGING_KEY_REGISTRY_ABI,
        functionName: "registerKey",
        args: [params.publicKey, params.algorithm ?? "x25519-xsalsa20-poly1305", expiresAt],
      });

      return wallet.sendTransaction({ to: keyRegistryAddress, data });
    },

    async getKey(owner) {
      const result = await wallet.publicClient.readContract({
        address: keyRegistryAddress,
        abi: MESSAGING_KEY_REGISTRY_ABI,
        functionName: "getKey",
        args: [owner],
      });

      if (result[0] === "0x") return null;

      return {
        owner,
        publicKey: result[0] as Hex,
        algorithm: result[1],
        registeredAt: result[2],
        expiresAt: result[3],
        isActive: result[4],
      };
    },

    async getMyKey() {
      return this.getKey(wallet.address);
    },

    async rotateKey(newPublicKey) {
      const data = encodeFunctionData({
        abi: MESSAGING_KEY_REGISTRY_ABI,
        functionName: "rotateKey",
        args: [newPublicKey],
      });
      return wallet.sendTransaction({ to: keyRegistryAddress, data });
    },

    async revokeKey() {
      const data = encodeFunctionData({
        abi: MESSAGING_KEY_REGISTRY_ABI,
        functionName: "revokeKey",
        args: [],
      });
      return wallet.sendTransaction({ to: keyRegistryAddress, data });
    },

    async claimFees(nodeId) {
      const data = encodeFunctionData({
        abi: MESSAGE_NODE_REGISTRY_ABI,
        functionName: "claimFees",
        args: [nodeId],
      });
      return wallet.sendTransaction({ to: nodeRegistryAddress, data });
    },

    async getPendingFees(nodeId) {
      return wallet.publicClient.readContract({
        address: nodeRegistryAddress,
        abi: MESSAGE_NODE_REGISTRY_ABI,
        functionName: "pendingFees",
        args: [nodeId],
      });
    },
  };
}

