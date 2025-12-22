/**
 * Cross-Chain Training Bridge
 *
 * Bridges training state between Solana (Psyche) and Jeju EVM.
 * Enables distributed training across multiple chains with:
 * - State synchronization
 * - Reward distribution
 * - Checkpoint coordination
 * - Client registration
 */

import { Connection, type Keypair, type PublicKey } from '@solana/web3.js'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  type Hash,
  type Hex,
  http,
  keccak256,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import type { CoordinatorState, PsycheClient } from './psyche-client'

// ============================================================================
// Constants
// ============================================================================

const BRIDGE_CONTRACT_ABI = [
  {
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'epoch', type: 'uint32' },
      { name: 'step', type: 'uint64' },
      { name: 'clientCount', type: 'uint32' },
      { name: 'modelHash', type: 'bytes32' },
      { name: 'solanaSignature', type: 'bytes' },
    ],
    name: 'reportProgress',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'checkpointCid', type: 'string' },
      { name: 'epoch', type: 'uint32' },
      { name: 'merkleRoot', type: 'bytes32' },
    ],
    name: 'submitCheckpoint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'clientAddress', type: 'address' },
      { name: 'solanaKey', type: 'bytes32' },
      { name: 'gpuType', type: 'string' },
      { name: 'gpuCount', type: 'uint8' },
      { name: 'memoryGb', type: 'uint16' },
    ],
    name: 'registerClient',
    outputs: [{ name: 'clientId', type: 'uint32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
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
    name: 'distributeRewards',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'runId', type: 'bytes32' }],
    name: 'getRunState',
    outputs: [
      { name: 'epoch', type: 'uint32' },
      { name: 'step', type: 'uint64' },
      { name: 'clientCount', type: 'uint32' },
      { name: 'lastCheckpointEpoch', type: 'uint32' },
      { name: 'totalRewardsDistributed', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'clientId', type: 'uint32' }],
    name: 'getClientInfo',
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
    type: 'function',
  },
] as const

// ============================================================================
// Types
// ============================================================================

export interface BridgeConfig {
  evmRpcUrl: string
  evmPrivateKey?: Hex
  bridgeContractAddress: Address
  solanaRpcUrl: string
  solanaKeypair?: Keypair
  syncIntervalMs?: number
}

export interface BridgedRunState {
  runId: string
  solanaState: CoordinatorState | null
  evmState: {
    epoch: number
    step: bigint
    clientCount: number
    lastCheckpointEpoch: number
    totalRewardsDistributed: bigint
  } | null
  lastSyncedAt: number
  inSync: boolean
}

export interface ClientRegistration {
  evmAddress: Address
  solanaKey: PublicKey
  gpuType: string
  gpuCount: number
  memoryGb: number
}

export interface RewardDistribution {
  client: Address
  amount: bigint
}

export interface CheckpointData {
  cid: string
  epoch: number
  merkleRoot: Hex
  modelHash: Hex
}

// ============================================================================
// Cross-Chain Bridge
// ============================================================================

export class CrossChainTrainingBridge {
  private evmPublicClient
  private evmWalletClient
  private evmAccount
  private solanaKeypair: Keypair | null = null
  private config: BridgeConfig
  private psycheClient: PsycheClient | null = null
  private syncInterval: NodeJS.Timeout | null = null
  private runStates: Map<string, BridgedRunState> = new Map()

  constructor(config: BridgeConfig) {
    this.config = config

    this.evmPublicClient = createPublicClient({
      chain: foundry,
      transport: http(config.evmRpcUrl),
    })

    if (config.evmPrivateKey) {
      this.evmAccount = privateKeyToAccount(config.evmPrivateKey)
      this.evmWalletClient = createWalletClient({
        account: this.evmAccount,
        chain: foundry,
        transport: http(config.evmRpcUrl),
      })
    }

    this.solanaConnection = new Connection(config.solanaRpcUrl, 'confirmed')

    if (config.solanaKeypair) {
      this.solanaKeypair = config.solanaKeypair
    }
  }

  setPsycheClient(client: PsycheClient): void {
    this.psycheClient = client
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
    }

    // Fetch initial states
    await this.syncRunState(runId, state)

    this.runStates.set(runId, state)
    return state
  }

  async getRunState(runId: string): Promise<BridgedRunState | null> {
    return this.runStates.get(runId) ?? null
  }

  // ============================================================================
  // State Synchronization
  // ============================================================================

  private async syncRunState(
    runId: string,
    state: BridgedRunState,
  ): Promise<void> {
    // Fetch Solana state via Psyche client
    if (this.psycheClient) {
      state.solanaState = await this.psycheClient.getRunState(runId)
    }

    // Fetch EVM state
    const runIdBytes =
      `0x${Buffer.from(runId).toString('hex').padEnd(64, '0')}` as Hex

    const evmResult = await this.evmPublicClient.readContract({
      address: this.config.bridgeContractAddress,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: 'getRunState',
      args: [runIdBytes],
    })

    state.evmState = {
      epoch: evmResult[0],
      step: evmResult[1],
      clientCount: evmResult[2],
      lastCheckpointEpoch: evmResult[3],
      totalRewardsDistributed: evmResult[4],
    }

    state.lastSyncedAt = Date.now()

    // Check if states are in sync
    if (state.solanaState && state.evmState) {
      state.inSync =
        state.solanaState.currentEpoch === state.evmState.epoch &&
        BigInt(state.solanaState.totalSteps) === state.evmState.step
    }
  }

  startAutoSync(intervalMs = 10000): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
    }

    this.syncInterval = setInterval(async () => {
      for (const [runId, state] of this.runStates) {
        await this.syncRunState(runId, state)

        // Auto-bridge if out of sync
        if (!state.inSync && state.solanaState) {
          await this.bridgeProgress(runId, state.solanaState)
        }
      }
    }, intervalMs)
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  // ============================================================================
  // Bridge Operations
  // ============================================================================

  async bridgeProgress(
    runId: string,
    solanaState: CoordinatorState,
  ): Promise<Hash> {
    if (!this.evmWalletClient) {
      throw new Error('EVM wallet required for bridging')
    }

    const runIdBytes =
      `0x${Buffer.from(runId).toString('hex').padEnd(64, '0')}` as Hex
    const modelHash =
      `0x${Buffer.from(solanaState.model.sha256).toString('hex').padEnd(64, '0')}` as Hex

    // Create signature placeholder (in production, this would be a Solana signature)
    const solanaSignature = new Uint8Array(64)

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
        `0x${Buffer.from(solanaSignature).toString('hex')}` as Hex,
      ],
    })

    console.log(`[Bridge] Bridged progress for ${runId}: ${hash}`)
    return hash
  }

  async submitCheckpoint(
    runId: string,
    checkpoint: CheckpointData,
  ): Promise<Hash> {
    if (!this.evmWalletClient) {
      throw new Error('EVM wallet required for checkpoint submission')
    }

    const runIdBytes =
      `0x${Buffer.from(runId).toString('hex').padEnd(64, '0')}` as Hex

    const hash = await this.evmWalletClient.writeContract({
      address: this.config.bridgeContractAddress,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: 'submitCheckpoint',
      args: [
        runIdBytes,
        checkpoint.cid,
        checkpoint.epoch,
        checkpoint.merkleRoot,
      ],
    })

    console.log(
      `[Bridge] Submitted checkpoint for ${runId} epoch ${checkpoint.epoch}: ${hash}`,
    )
    return hash
  }

  async registerClient(registration: ClientRegistration): Promise<number> {
    if (!this.evmWalletClient) {
      throw new Error('EVM wallet required for client registration')
    }

    const solanaKeyBytes =
      `0x${registration.solanaKey.toBuffer().toString('hex')}` as Hex

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
    })

    console.log(
      `[Bridge] Registered client ${registration.evmAddress}: ${hash}`,
    )

    // Wait for transaction and get client ID from logs
    const _receipt = await this.evmPublicClient.waitForTransactionReceipt({
      hash,
    })

    // Parse client ID from logs (simplified)
    return 0 // Would parse from _receipt.logs
  }

  async distributeRewards(
    runId: string,
    epoch: number,
    rewards: RewardDistribution[],
    merkleProof: Hex[],
  ): Promise<Hash> {
    if (!this.evmWalletClient) {
      throw new Error('EVM wallet required for reward distribution')
    }

    const runIdBytes =
      `0x${Buffer.from(runId).toString('hex').padEnd(64, '0')}` as Hex

    const hash = await this.evmWalletClient.writeContract({
      address: this.config.bridgeContractAddress,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: 'distributeRewards',
      args: [runIdBytes, epoch, rewards, merkleProof],
    })

    console.log(
      `[Bridge] Distributed rewards for ${runId} epoch ${epoch}: ${hash}`,
    )
    return hash
  }

  // ============================================================================
  // Merkle Tree for Reward Verification
  // ============================================================================

  computeRewardsMerkleRoot(rewards: RewardDistribution[]): Hex {
    const leaves = rewards.map((r) =>
      keccak256(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }],
          [r.client, r.amount],
        ),
      ),
    )

    // Build merkle tree
    let level = leaves
    while (level.length > 1) {
      const nextLevel: Hex[] = []
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 < level.length) {
          // Sort to ensure consistent ordering
          const [left, right] =
            level[i] < level[i + 1]
              ? [level[i], level[i + 1]]
              : [level[i + 1], level[i]]
          nextLevel.push(
            keccak256(
              encodeAbiParameters(
                [{ type: 'bytes32' }, { type: 'bytes32' }],
                [left, right],
              ),
            ),
          )
        } else {
          nextLevel.push(level[i])
        }
      }
      level = nextLevel
    }

    return level[0] ?? (`0x${'0'.repeat(64)}` as Hex)
  }

  generateMerkleProof(rewards: RewardDistribution[], index: number): Hex[] {
    const leaves = rewards.map((r) =>
      keccak256(
        encodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }],
          [r.client, r.amount],
        ),
      ),
    )

    const proof: Hex[] = []
    let currentIndex = index
    let level = leaves

    while (level.length > 1) {
      const nextLevel: Hex[] = []
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 < level.length) {
          const [left, right] =
            level[i] < level[i + 1]
              ? [level[i], level[i + 1]]
              : [level[i + 1], level[i]]

          // Add sibling to proof if this is our path
          if (i === currentIndex || i + 1 === currentIndex) {
            proof.push(i === currentIndex ? level[i + 1] : level[i])
          }

          nextLevel.push(
            keccak256(
              encodeAbiParameters(
                [{ type: 'bytes32' }, { type: 'bytes32' }],
                [left, right],
              ),
            ),
          )
        } else {
          nextLevel.push(level[i])
        }
      }
      currentIndex = Math.floor(currentIndex / 2)
      level = nextLevel
    }

    return proof
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  async getClientInfo(clientId: number): Promise<{
    evmAddress: Address
    solanaKey: Hex
    gpuType: string
    gpuCount: number
    memoryGb: number
    stepsContributed: bigint
    rewardsClaimed: bigint
  }> {
    const result = await this.evmPublicClient.readContract({
      address: this.config.bridgeContractAddress,
      abi: BRIDGE_CONTRACT_ABI,
      functionName: 'getClientInfo',
      args: [clientId],
    })

    return {
      evmAddress: result[0],
      solanaKey: result[1],
      gpuType: result[2],
      gpuCount: result[3],
      memoryGb: result[4],
      stepsContributed: result[5],
      rewardsClaimed: result[6],
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCrossChainBridge(
  config: BridgeConfig,
): CrossChainTrainingBridge {
  return new CrossChainTrainingBridge(config)
}
