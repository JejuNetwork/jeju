/**
 * Cross-Chain Training Bridge
 * 
 * Bridges training state between Solana (Psyche) and Jeju EVM.
 * Enables distributed training across multiple chains with:
 * - State synchronization
 * - Reward distribution
 * - Checkpoint coordination
 * - Client registration
 * - Real Merkle proofs for reward verification
 */

import {
  PublicKey,
  Keypair,
} from '@solana/web3.js';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type Hash,
  encodeAbiParameters,
  keccak256,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import type { PsycheClient, CoordinatorState } from './psyche-client';

// ============================================================================
// ABI Definitions
// ============================================================================

const BRIDGE_CONTRACT_ABI = [
  {
    type: 'function',
    name: 'reportProgress',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'epoch', type: 'uint32' },
      { name: 'step', type: 'uint64' },
      { name: 'clientCount', type: 'uint32' },
      { name: 'modelHash', type: 'bytes32' },
      { name: 'solanaSignature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'submitCheckpoint',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'checkpointCid', type: 'string' },
      { name: 'epoch', type: 'uint32' },
      { name: 'merkleRoot', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registerClient',
    inputs: [
      { name: 'clientAddress', type: 'address' },
      { name: 'solanaKey', type: 'bytes32' },
      { name: 'gpuType', type: 'string' },
      { name: 'gpuCount', type: 'uint8' },
      { name: 'memoryGb', type: 'uint16' },
    ],
    outputs: [{ name: 'clientId', type: 'uint32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'distributeRewards',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'epoch', type: 'uint32' },
      { 
        name: 'rewards', 
        type: 'tuple[]',
        components: [
          { name: 'client', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      { name: 'merkleProof', type: 'bytes32[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getRunState',
    inputs: [{ name: 'runId', type: 'bytes32' }],
    outputs: [
      { name: 'epoch', type: 'uint32' },
      { name: 'step', type: 'uint64' },
      { name: 'clientCount', type: 'uint32' },
      { name: 'lastCheckpointEpoch', type: 'uint32' },
      { name: 'totalRewardsDistributed', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getClientInfo',
    inputs: [{ name: 'clientId', type: 'uint32' }],
    outputs: [
      { name: 'evmAddress', type: 'address' },
      { name: 'solanaKey', type: 'bytes32' },
      { name: 'gpuType', type: 'string' },
      { name: 'gpuCount', type: 'uint8' },
      { name: 'memoryGb', type: 'uint16' },
      { name: 'stepsContributed', type: 'uint64' },
      { name: 'rewardsClaimed', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setRewardMerkleRoot',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'epoch', type: 'uint32' },
      { name: 'merkleRoot', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimReward',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'epoch', type: 'uint32' },
      { name: 'amount', type: 'uint256' },
      { name: 'merkleProof', type: 'bytes32[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'ProgressReported',
    inputs: [
      { name: 'runId', type: 'bytes32', indexed: true },
      { name: 'epoch', type: 'uint32', indexed: false },
      { name: 'step', type: 'uint64', indexed: false },
      { name: 'clientCount', type: 'uint32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'CheckpointSubmitted',
    inputs: [
      { name: 'runId', type: 'bytes32', indexed: true },
      { name: 'epoch', type: 'uint32', indexed: false },
      { name: 'cid', type: 'string', indexed: false },
      { name: 'merkleRoot', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ClientRegistered',
    inputs: [
      { name: 'clientId', type: 'uint32', indexed: true },
      { name: 'evmAddress', type: 'address', indexed: true },
      { name: 'solanaKey', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RewardsDistributed',
    inputs: [
      { name: 'runId', type: 'bytes32', indexed: true },
      { name: 'epoch', type: 'uint32', indexed: false },
      { name: 'totalAmount', type: 'uint256', indexed: false },
    ],
  },
] as const;

// ============================================================================
// Types
// ============================================================================

export interface BridgeConfig {
  evmRpcUrl: string;
  evmPrivateKey?: Hex;
  bridgeContractAddress: Address;
  solanaRpcUrl: string;
  solanaKeypair?: Keypair;
  syncIntervalMs?: number;
}

export interface BridgedRunState {
  runId: string;
  solanaState: CoordinatorState | null;
  evmState: {
    epoch: number;
    step: bigint;
    clientCount: number;
    lastCheckpointEpoch: number;
    totalRewardsDistributed: bigint;
  } | null;
  lastSyncedAt: number;
  inSync: boolean;
}

export interface ClientRegistration {
  evmAddress: Address;
  solanaKey: PublicKey;
  gpuType: string;
  gpuCount: number;
  memoryGb: number;
}

export interface RewardDistribution {
  client: Address;
  amount: bigint;
}

export interface CheckpointData {
  cid: string;
  epoch: number;
  merkleRoot: Hex;
  modelHash: Hex;
}

// ============================================================================
// Merkle Tree Implementation
// ============================================================================

class MerkleTree {
  private leaves: Hex[];
  private layers: Hex[][];

  constructor(leaves: Hex[]) {
    this.leaves = leaves.length > 0 ? leaves : [keccak256('0x00')];
    this.layers = this.buildTree();
  }

  private buildTree(): Hex[][] {
    const layers: Hex[][] = [this.leaves];
    let currentLayer = this.leaves;

    while (currentLayer.length > 1) {
      const nextLayer: Hex[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          const [left, right] = this.sortPair(currentLayer[i], currentLayer[i + 1]);
          nextLayer.push(this.hashPair(left, right));
        } else {
          nextLayer.push(currentLayer[i]);
        }
      }
      layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    return layers;
  }

  private sortPair(a: Hex, b: Hex): [Hex, Hex] {
    return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  }

  private hashPair(left: Hex, right: Hex): Hex {
    return keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }],
        [left, right]
      )
    );
  }

  getRoot(): Hex {
    return this.layers[this.layers.length - 1][0];
  }

  getProof(index: number): Hex[] {
    const proof: Hex[] = [];
    let currentIndex = index;

    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i];
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;

      if (siblingIndex < layer.length) {
        proof.push(layer[siblingIndex]);
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
  }

  static verify(leaf: Hex, proof: Hex[], root: Hex): boolean {
    let computedHash = leaf;

    for (const proofElement of proof) {
      const [left, right] = computedHash.toLowerCase() < proofElement.toLowerCase()
        ? [computedHash, proofElement]
        : [proofElement, computedHash];

      computedHash = keccak256(
        encodeAbiParameters(
          [{ type: 'bytes32' }, { type: 'bytes32' }],
          [left, right]
        )
      );
    }

    return computedHash.toLowerCase() === root.toLowerCase();
  }
}

// ============================================================================
// Cross-Chain Bridge
// ============================================================================

export class CrossChainTrainingBridge {
  private evmPublicClient;
  private evmWalletClient;
  private evmAccount;
  private solanaKeypair: Keypair | null = null;
  private config: BridgeConfig;
  private psycheClient: PsycheClient | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private runStates: Map<string, BridgedRunState> = new Map();

  constructor(config: BridgeConfig) {
    this.config = config;

    this.evmPublicClient = createPublicClient({
      chain: foundry,
      transport: http(config.evmRpcUrl),
    });

    if (config.evmPrivateKey) {
      this.evmAccount = privateKeyToAccount(config.evmPrivateKey);
      this.evmWalletClient = createWalletClient({
        account: this.evmAccount,
        chain: foundry,
        transport: http(config.evmRpcUrl),
      });
    }
    
    if (config.solanaKeypair) {
      this.solanaKeypair = config.solanaKeypair;
    }
  }

  setPsycheClient(client: PsycheClient): void {
    this.psycheClient = client;
  }

  // ============================================================================
  // Run Management
  // ============================================================================

  async trackRun(runId: string): Promise<BridgedRunState> {
    const state: BridgedRunState = {
      runId,
      solanaState: null,
      evmState: null,
      lastSyncedAt: 0,
      inSync: false,
    };

    await this.syncRunState(runId, state);
    this.runStates.set(runId, state);
    return state;
  }

  async getRunState(runId: string): Promise<BridgedRunState | null> {
    return this.runStates.get(runId) ?? null;
  }

  // ============================================================================
  // State Synchronization
  // ============================================================================

  private async syncRunState(runId: string, state: BridgedRunState): Promise<void> {
    // Fetch Solana state via Psyche client
    if (this.psycheClient) {
      state.solanaState = await this.psycheClient.getRunState(runId);
    }

    // Fetch EVM state
    const runIdBytes = this.runIdToBytes32(runId);
    
    try {
      const evmResult = await this.evmPublicClient.readContract({
        address: this.config.bridgeContractAddress,
        abi: BRIDGE_CONTRACT_ABI,
        functionName: 'getRunState',
        args: [runIdBytes],
      });

      state.evmState = {
        epoch: evmResult[0],
        step: evmResult[1],
        clientCount: evmResult[2],
        lastCheckpointEpoch: evmResult[3],
        totalRewardsDistributed: evmResult[4],
      };
    } catch {
      // Contract might not have state yet
      state.evmState = null;
    }

    state.lastSyncedAt = Date.now();

    // Check if states are in sync
    if (state.solanaState && state.evmState) {
      state.inSync =
        state.solanaState.currentEpoch === state.evmState.epoch &&
        BigInt(state.solanaState.totalSteps) === state.evmState.step;
    }
  }

  startAutoSync(intervalMs = 10000): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      for (const [runId, state] of this.runStates) {
        await this.syncRunState(runId, state);
        
        // Auto-bridge if out of sync
        if (!state.inSync && state.solanaState) {
          await this.bridgeProgress(runId, state.solanaState);
        }
      }
    }, intervalMs);
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // ============================================================================
  // Bridge Operations
  // ============================================================================

  async bridgeProgress(runId: string, solanaState: CoordinatorState): Promise<Hash> {
    if (!this.evmWalletClient) {
      throw new Error('EVM wallet required for bridging');
    }

    const runIdBytes = this.runIdToBytes32(runId);
    const modelHash = this.stringToBytes32(solanaState.model.sha256);

    // Create signature from Solana keypair if available
    let solanaSignature: Hex = `0x${'00'.repeat(64)}` as Hex;
    if (this.solanaKeypair) {
      const message = Buffer.concat([
        Buffer.from(runId),
        Buffer.from(new Uint32Array([solanaState.currentEpoch]).buffer),
        Buffer.from(new BigUint64Array([BigInt(solanaState.totalSteps)]).buffer),
      ]);
      
      const { sign } = await import('tweetnacl');
      const sig = sign.detached(message, this.solanaKeypair.secretKey);
      solanaSignature = `0x${Buffer.from(sig).toString('hex')}` as Hex;
    }

    const hash = await this.evmWalletClient.writeContract({
      address: this.config.bridgeContractAddress,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: 'reportProgress',
      args: [
        runIdBytes,
        solanaState.currentEpoch,
        BigInt(solanaState.totalSteps),
        solanaState.clients.length,
        modelHash,
        solanaSignature,
      ],
    });

    console.log(`[Bridge] Bridged progress for ${runId}: ${hash}`);
    return hash;
  }

  async submitCheckpoint(
    runId: string,
    checkpoint: CheckpointData
  ): Promise<Hash> {
    if (!this.evmWalletClient) {
      throw new Error('EVM wallet required for checkpoint submission');
    }

    const runIdBytes = this.runIdToBytes32(runId);

    const hash = await this.evmWalletClient.writeContract({
      address: this.config.bridgeContractAddress,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: 'submitCheckpoint',
      args: [runIdBytes, checkpoint.cid, checkpoint.epoch, checkpoint.merkleRoot],
    });

    console.log(`[Bridge] Submitted checkpoint for ${runId} epoch ${checkpoint.epoch}: ${hash}`);
    return hash;
  }

  async registerClient(registration: ClientRegistration): Promise<number> {
    if (!this.evmWalletClient) {
      throw new Error('EVM wallet required for client registration');
    }

    const solanaKeyBytes = `0x${registration.solanaKey.toBuffer().toString('hex')}` as Hex;

    const hash = await this.evmWalletClient.writeContract({
      address: this.config.bridgeContractAddress,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: 'registerClient',
      args: [
        registration.evmAddress,
        solanaKeyBytes,
        registration.gpuType,
        registration.gpuCount,
        registration.memoryGb,
      ],
    });

    console.log(`[Bridge] Registered client ${registration.evmAddress}: ${hash}`);

    // Wait for transaction and get client ID from logs
    const receipt = await this.evmPublicClient.waitForTransactionReceipt({ hash });
    
    // Parse client ID from logs
    const eventSignature = keccak256(
      new TextEncoder().encode('ClientRegistered(uint32,address,bytes32)')
    );
    for (const log of receipt.logs) {
      // Find ClientRegistered event
      if (log.topics[0] === eventSignature) {
        const clientId = parseInt(log.topics[1] ?? '0', 16);
        return clientId;
      }
    }

    return 0;
  }

  async distributeRewards(
    runId: string,
    epoch: number,
    rewards: RewardDistribution[],
    merkleProof: Hex[]
  ): Promise<Hash> {
    if (!this.evmWalletClient) {
      throw new Error('EVM wallet required for reward distribution');
    }

    const runIdBytes = this.runIdToBytes32(runId);

    const hash = await this.evmWalletClient.writeContract({
      address: this.config.bridgeContractAddress,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: 'distributeRewards',
      args: [runIdBytes, epoch, rewards, merkleProof],
    });

    console.log(`[Bridge] Distributed rewards for ${runId} epoch ${epoch}: ${hash}`);
    return hash;
  }

  async setRewardMerkleRoot(runId: string, epoch: number, merkleRoot: Hex): Promise<Hash> {
    if (!this.evmWalletClient) {
      throw new Error('EVM wallet required');
    }

    const runIdBytes = this.runIdToBytes32(runId);

    const hash = await this.evmWalletClient.writeContract({
      address: this.config.bridgeContractAddress,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: 'setRewardMerkleRoot',
      args: [runIdBytes, epoch, merkleRoot],
    });

    return hash;
  }

  // ============================================================================
  // Merkle Tree for Reward Verification
  // ============================================================================

  computeRewardsMerkleRoot(rewards: RewardDistribution[]): Hex {
    const leaves = rewards.map((r) =>
      keccak256(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }],
          [r.client, r.amount]
        )
      )
    );

    const tree = new MerkleTree(leaves);
    return tree.getRoot();
  }

  generateMerkleProof(rewards: RewardDistribution[], index: number): Hex[] {
    const leaves = rewards.map((r) =>
      keccak256(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }],
          [r.client, r.amount]
        )
      )
    );

    const tree = new MerkleTree(leaves);
    return tree.getProof(index);
  }

  verifyMerkleProof(
    leaf: Hex,
    proof: Hex[],
    root: Hex
  ): boolean {
    return MerkleTree.verify(leaf, proof, root);
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private runIdToBytes32(runId: string): Hex {
    return `0x${Buffer.from(runId).toString('hex').padEnd(64, '0')}` as Hex;
  }

  private stringToBytes32(str: string): Hex {
    const hex = Buffer.from(str).toString('hex');
    return `0x${hex.padEnd(64, '0')}` as Hex;
  }

  async getClientInfo(
    clientId: number
  ): Promise<{
    evmAddress: Address;
    solanaKey: Hex;
    gpuType: string;
    gpuCount: number;
    memoryGb: number;
    stepsContributed: bigint;
    rewardsClaimed: bigint;
  }> {
    const result = await this.evmPublicClient.readContract({
      address: this.config.bridgeContractAddress,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: 'getClientInfo',
      args: [clientId],
    });

    return {
      evmAddress: result[0],
      solanaKey: result[1],
      gpuType: result[2],
      gpuCount: result[3],
      memoryGb: result[4],
      stepsContributed: result[5],
      rewardsClaimed: result[6],
    };
  }

  getEvmPublicClient() {
    return this.evmPublicClient;
  }

  getEvmWalletClient() {
    return this.evmWalletClient;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCrossChainBridge(config: BridgeConfig): CrossChainTrainingBridge {
  return new CrossChainTrainingBridge(config);
}
