/**
 * Psyche Client for Jeju DWS
 *
 * TypeScript client for Nous Research's Psyche distributed training network.
 * Handles coordination between Solana-based Psyche network and Jeju's EVM chain.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import * as borsh from 'borsh'
import {
  type Address,
  createWalletClient,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

// ============================================================================
// Constants
// ============================================================================

// Psyche program IDs from vendor_examples/psyche
const PSYCHE_COORDINATOR_PROGRAM_ID = new PublicKey(
  '4SHugWqSXwKE5fqDchkJcPEqnoZE22VYKtSTVm7axbT7',
)

const PSYCHE_MINING_POOL_PROGRAM_ID = new PublicKey(
  '4SHugWqSXwKE5fqDchkJcPEqnoZE22VYKtSTVm7axbT7', // Placeholder
)

// ============================================================================
// Types
// ============================================================================

export interface PsycheConfig {
  solanaRpcUrl: string
  solanaWsUrl?: string
  evmRpcUrl?: string
  evmPrivateKey?: Hex
  solanaKeypair?: Keypair
}

export interface RunMetadata {
  name: string
  description: string
  modelHubRepo: string
  datasetHubRepo: string
}

export interface CoordinatorConfig {
  maxClients: number
  minClients: number
  epochLengthMs: number
  warmupEpochs: number
  checkpointIntervalEpochs: number
  learningRate: number
  batchSize: number
  gradientAccumulationSteps: number
  maxSeqLength: number
}

export interface Model {
  hubRepo: string
  revision: string
  sha256: string
}

export type CoordinatorProgress =
  | { type: 'Uninitialized' }
  | { type: 'WarmingUp'; epoch: number }
  | { type: 'Training'; epoch: number; step: number }
  | { type: 'Checkpointing'; epoch: number }
  | { type: 'Paused'; lastEpoch: number }
  | { type: 'Finished' }

export interface CoordinatorState {
  runId: string
  metadata: RunMetadata
  config: CoordinatorConfig
  model: Model
  progress: CoordinatorProgress
  clients: ClientInfo[]
  currentEpoch: number
  totalSteps: number
  paused: boolean
}

export interface ClientInfo {
  id: number
  pubkey: PublicKey
  gpuType: string
  gpuCount: number
  memoryGb: number
  joinedAt: number
  lastHealthCheck: number
  stepsContributed: number
  healthy: boolean
}

export interface WitnessProof {
  signature: Uint8Array
  timestamp: number
  participantCount: number
}

export interface TrainingMetrics {
  loss: number
  learningRate: number
  gradNorm: number
  epochProgress: number
  samplesProcessed: number
  tokensProcessed: number
}

// ============================================================================
// Borsh Schema for Solana Instructions
// ============================================================================

class InitCoordinatorInstruction {
  instruction = 0
  runId: string
  metadata: {
    name: string
    description: string
    modelHubRepo: string
    datasetHubRepo: string
  }
  config: {
    maxClients: number
    minClients: number
    epochLengthMs: bigint
    warmupEpochs: number
    checkpointIntervalEpochs: number
    learningRate: number
    batchSize: number
    gradientAccumulationSteps: number
    maxSeqLength: number
  }
  model: {
    hubRepo: string
    revision: string
    sha256: string
  }

  constructor(
    runId: string,
    metadata: RunMetadata,
    config: CoordinatorConfig,
    model: Model,
  ) {
    this.runId = runId
    this.metadata = metadata
    this.config = {
      ...config,
      epochLengthMs: BigInt(config.epochLengthMs),
    }
    this.model = model
  }
}

class JoinRunInstruction {
  instruction = 1
  clientId: number
  gpuType: string
  gpuCount: number
  memoryGb: number

  constructor(
    clientId: number,
    gpuType: string,
    gpuCount: number,
    memoryGb: number,
  ) {
    this.clientId = clientId
    this.gpuType = gpuType
    this.gpuCount = gpuCount
    this.memoryGb = memoryGb
  }
}

class TickInstruction {
  instruction = 2
}

class WitnessInstruction {
  instruction = 3
  proof: Uint8Array
  participantBloom: Uint8Array
  broadcastBloom: Uint8Array
  broadcastMerkle: Uint8Array

  constructor(
    proof: Uint8Array,
    participantBloom: Uint8Array,
    broadcastBloom: Uint8Array,
    broadcastMerkle: Uint8Array,
  ) {
    this.proof = proof
    this.participantBloom = participantBloom
    this.broadcastBloom = broadcastBloom
    this.broadcastMerkle = broadcastMerkle
  }
}

class HealthCheckInstruction {
  instruction = 4
  clientId: number

  constructor(clientId: number) {
    this.clientId = clientId
  }
}

class CheckpointInstruction {
  instruction = 5
  hubRepo: string

  constructor(hubRepo: string) {
    this.hubRepo = hubRepo
  }
}

// ============================================================================
// Psyche Client
// ============================================================================

export class PsycheClient {
  private connection: Connection
  private evmWalletClient: ReturnType<typeof createWalletClient> | null = null
  private evmAccount: ReturnType<typeof privateKeyToAccount> | null = null
  private solanaKeypair: Keypair | null = null

  constructor(config: PsycheConfig) {
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed')

    if (config.solanaKeypair) {
      this.solanaKeypair = config.solanaKeypair
    }

    if (config.evmRpcUrl && config.evmPrivateKey) {
      this.evmAccount = privateKeyToAccount(config.evmPrivateKey)
      this.evmWalletClient = createWalletClient({
        account: this.evmAccount,
        chain: foundry,
        transport: http(config.evmRpcUrl),
      })
    }
  }

  // ============================================================================
  // Run Management
  // ============================================================================

  async createRun(
    runId: string,
    metadata: RunMetadata,
    config: CoordinatorConfig,
    model: Model,
  ): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required to create runs')
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID,
    )

    const coordinatorAccount = Keypair.generate()

    const instruction = new InitCoordinatorInstruction(
      runId,
      metadata,
      config,
      model,
    )
    const data = borsh.serialize(
      {
        struct: {
          instruction: 'u8',
          runId: 'string',
          metadata: {
            struct: {
              name: 'string',
              description: 'string',
              modelHubRepo: 'string',
              datasetHubRepo: 'string',
            },
          },
          config: {
            struct: {
              maxClients: 'u32',
              minClients: 'u32',
              epochLengthMs: 'u64',
              warmupEpochs: 'u32',
              checkpointIntervalEpochs: 'u32',
              learningRate: 'f32',
              batchSize: 'u32',
              gradientAccumulationSteps: 'u32',
              maxSeqLength: 'u32',
            },
          },
          model: {
            struct: {
              hubRepo: 'string',
              revision: 'string',
              sha256: 'string',
            },
          },
        },
      },
      instruction,
    )

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          {
            pubkey: this.solanaKeypair.publicKey,
            isSigner: true,
            isWritable: true,
          },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
          {
            pubkey: coordinatorAccount.publicKey,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data: Buffer.from(data),
      }),
    )

    const signature = await sendAndConfirmTransaction(this.connection, tx, [
      this.solanaKeypair,
      coordinatorAccount,
    ])

    console.log(`[Psyche] Created run ${runId}: ${signature}`)
    return signature
  }

  async getRunState(runId: string): Promise<CoordinatorState | null> {
    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID,
    )

    const accountInfo =
      await this.connection.getAccountInfo(coordinatorInstance)
    if (!accountInfo) {
      return null
    }

    // Parse the account data (simplified - real implementation would decode properly)
    const data = accountInfo.data

    // Skip discriminator (8 bytes) and version (8 bytes)
    const stateOffset = 16

    return {
      runId,
      metadata: {
        name: '',
        description: '',
        modelHubRepo: '',
        datasetHubRepo: '',
      },
      config: {
        maxClients: data.readUInt32LE(stateOffset),
        minClients: data.readUInt32LE(stateOffset + 4),
        epochLengthMs: Number(data.readBigUInt64LE(stateOffset + 8)),
        warmupEpochs: data.readUInt32LE(stateOffset + 16),
        checkpointIntervalEpochs: data.readUInt32LE(stateOffset + 20),
        learningRate: data.readFloatLE(stateOffset + 24),
        batchSize: data.readUInt32LE(stateOffset + 28),
        gradientAccumulationSteps: data.readUInt32LE(stateOffset + 32),
        maxSeqLength: data.readUInt32LE(stateOffset + 36),
      },
      model: {
        hubRepo: '',
        revision: '',
        sha256: '',
      },
      progress: { type: 'Uninitialized' },
      clients: [],
      currentEpoch: 0,
      totalSteps: 0,
      paused: false,
    }
  }

  async joinRun(
    runId: string,
    clientId: number,
    gpuType: string,
    gpuCount: number,
    memoryGb: number,
  ): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required to join runs')
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID,
    )

    const instruction = new JoinRunInstruction(
      clientId,
      gpuType,
      gpuCount,
      memoryGb,
    )
    const data = borsh.serialize(
      {
        struct: {
          instruction: 'u8',
          clientId: 'u32',
          gpuType: 'string',
          gpuCount: 'u32',
          memoryGb: 'u32',
        },
      },
      instruction,
    )

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          {
            pubkey: this.solanaKeypair.publicKey,
            isSigner: true,
            isWritable: false,
          },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(data),
      }),
    )

    const signature = await sendAndConfirmTransaction(this.connection, tx, [
      this.solanaKeypair,
    ])

    console.log(
      `[Psyche] Joined run ${runId} as client ${clientId}: ${signature}`,
    )
    return signature
  }

  async tick(runId: string): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required')
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID,
    )

    const instruction = new TickInstruction()
    const data = borsh.serialize({ struct: { instruction: 'u8' } }, instruction)

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          {
            pubkey: this.solanaKeypair.publicKey,
            isSigner: true,
            isWritable: false,
          },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(data),
      }),
    )

    return sendAndConfirmTransaction(this.connection, tx, [this.solanaKeypair])
  }

  async submitWitness(
    runId: string,
    proof: WitnessProof,
    participantBloom: Uint8Array,
    broadcastBloom: Uint8Array,
    broadcastMerkle: Uint8Array,
  ): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required')
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID,
    )

    const instruction = new WitnessInstruction(
      proof.signature,
      participantBloom,
      broadcastBloom,
      broadcastMerkle,
    )

    const data = borsh.serialize(
      {
        struct: {
          instruction: 'u8',
          proof: { array: { type: 'u8' } },
          participantBloom: { array: { type: 'u8' } },
          broadcastBloom: { array: { type: 'u8' } },
          broadcastMerkle: { array: { type: 'u8' } },
        },
      },
      instruction,
    )

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          {
            pubkey: this.solanaKeypair.publicKey,
            isSigner: true,
            isWritable: false,
          },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(data),
      }),
    )

    return sendAndConfirmTransaction(this.connection, tx, [this.solanaKeypair])
  }

  async healthCheck(runId: string, clientId: number): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required')
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID,
    )

    const instruction = new HealthCheckInstruction(clientId)
    const data = borsh.serialize(
      {
        struct: {
          instruction: 'u8',
          clientId: 'u32',
        },
      },
      instruction,
    )

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          {
            pubkey: this.solanaKeypair.publicKey,
            isSigner: true,
            isWritable: false,
          },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(data),
      }),
    )

    return sendAndConfirmTransaction(this.connection, tx, [this.solanaKeypair])
  }

  async checkpoint(runId: string, hubRepo: string): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required')
    }

    const [coordinatorInstance] = PublicKey.findProgramAddressSync(
      [Buffer.from('coordinator'), Buffer.from(runId.slice(0, 32))],
      PSYCHE_COORDINATOR_PROGRAM_ID,
    )

    const instruction = new CheckpointInstruction(hubRepo)
    const data = borsh.serialize(
      {
        struct: {
          instruction: 'u8',
          hubRepo: 'string',
        },
      },
      instruction,
    )

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_COORDINATOR_PROGRAM_ID,
        keys: [
          {
            pubkey: this.solanaKeypair.publicKey,
            isSigner: true,
            isWritable: false,
          },
          { pubkey: coordinatorInstance, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(data),
      }),
    )

    return sendAndConfirmTransaction(this.connection, tx, [this.solanaKeypair])
  }

  // ============================================================================
  // Mining Pool Integration
  // ============================================================================

  async createMiningPool(
    poolId: string,
    rewardMint: PublicKey,
    epochDurationMs: number,
  ): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required')
    }

    const [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), Buffer.from(poolId.slice(0, 32))],
      PSYCHE_MINING_POOL_PROGRAM_ID,
    )

    // Pool creation instruction
    const data = Buffer.alloc(1 + 32 + 8)
    data.writeUInt8(0, 0) // Instruction: create_pool
    Buffer.from(poolId.slice(0, 32)).copy(data, 1)
    data.writeBigUInt64LE(BigInt(epochDurationMs), 33)

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_MINING_POOL_PROGRAM_ID,
        keys: [
          {
            pubkey: this.solanaKeypair.publicKey,
            isSigner: true,
            isWritable: true,
          },
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: rewardMint, isSigner: false, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data,
      }),
    )

    return sendAndConfirmTransaction(this.connection, tx, [this.solanaKeypair])
  }

  async depositToPool(poolId: string, amount: bigint): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required')
    }

    const [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), Buffer.from(poolId.slice(0, 32))],
      PSYCHE_MINING_POOL_PROGRAM_ID,
    )

    const [lenderPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('lender'),
        Buffer.from(poolId.slice(0, 32)),
        this.solanaKeypair.publicKey.toBuffer(),
      ],
      PSYCHE_MINING_POOL_PROGRAM_ID,
    )

    const data = Buffer.alloc(1 + 8)
    data.writeUInt8(1, 0) // Instruction: deposit
    data.writeBigUInt64LE(amount, 1)

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_MINING_POOL_PROGRAM_ID,
        keys: [
          {
            pubkey: this.solanaKeypair.publicKey,
            isSigner: true,
            isWritable: true,
          },
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: lenderPda, isSigner: false, isWritable: true },
        ],
        data,
      }),
    )

    return sendAndConfirmTransaction(this.connection, tx, [this.solanaKeypair])
  }

  async claimRewards(poolId: string): Promise<string> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required')
    }

    const [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), Buffer.from(poolId.slice(0, 32))],
      PSYCHE_MINING_POOL_PROGRAM_ID,
    )

    const [lenderPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('lender'),
        Buffer.from(poolId.slice(0, 32)),
        this.solanaKeypair.publicKey.toBuffer(),
      ],
      PSYCHE_MINING_POOL_PROGRAM_ID,
    )

    const data = Buffer.alloc(1)
    data.writeUInt8(2, 0) // Instruction: claim

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PSYCHE_MINING_POOL_PROGRAM_ID,
        keys: [
          {
            pubkey: this.solanaKeypair.publicKey,
            isSigner: true,
            isWritable: true,
          },
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: lenderPda, isSigner: false, isWritable: true },
        ],
        data,
      }),
    )

    return sendAndConfirmTransaction(this.connection, tx, [this.solanaKeypair])
  }

  // ============================================================================
  // Cross-Chain Bridge to Jeju EVM
  // ============================================================================

  async bridgeProgressToEVM(
    runId: string,
    state: CoordinatorState,
    bridgeAddress: Address,
  ): Promise<Hex> {
    if (!this.evmWalletClient || !this.evmAccount) {
      throw new Error('EVM wallet required for bridging')
    }

    const abi = [
      {
        inputs: [
          { name: 'runId', type: 'bytes32' },
          { name: 'epoch', type: 'uint32' },
          { name: 'step', type: 'uint64' },
          { name: 'clientCount', type: 'uint32' },
          { name: 'modelHash', type: 'bytes32' },
        ],
        name: 'reportProgress',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ] as const

    const runIdBytes =
      `0x${Buffer.from(runId).toString('hex').padEnd(64, '0')}` as Hex
    const modelHash =
      `0x${Buffer.from(state.model.sha256).toString('hex').padEnd(64, '0')}` as Hex

    const hash = await this.evmWalletClient.writeContract({
      address: bridgeAddress,
      abi,
      functionName: 'reportProgress',
      args: [
        runIdBytes,
        state.currentEpoch,
        BigInt(state.totalSteps),
        state.clients.length,
        modelHash,
      ],
    })

    console.log(`[Psyche] Bridged progress to EVM: ${hash}`)
    return hash
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  async getBalance(): Promise<number> {
    if (!this.solanaKeypair) {
      throw new Error('Solana keypair required')
    }
    return this.connection.getBalance(this.solanaKeypair.publicKey)
  }

  getPublicKey(): PublicKey | null {
    return this.solanaKeypair?.publicKey ?? null
  }

  getEvmAddress(): Address | null {
    return this.evmAccount?.address ?? null
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createPsycheClient(config: PsycheConfig): PsycheClient {
  return new PsycheClient(config)
}
