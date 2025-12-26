/**
 * Psyche distributed training client for Solana/EVM coordination.
 */

import {
  getPsycheCoordinatorProgramId,
  getPsycheMiningPoolProgramId,
} from '@jejunetwork/config'
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
import { type Address, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

let _coordinatorProgramId: PublicKey | null = null
let _miningPoolProgramId: PublicKey | null = null

function getCoordinatorProgramId(): PublicKey {
  if (!_coordinatorProgramId) {
    const programId = getPsycheCoordinatorProgramId()
    if (!programId) {
      throw new Error(
        'PSYCHE_COORDINATOR_PROGRAM_ID env var required to use Psyche integration',
      )
    }
    _coordinatorProgramId = new PublicKey(programId)
  }
  return _coordinatorProgramId
}

function getMiningPoolProgramId(): PublicKey {
  if (!_miningPoolProgramId) {
    const programId = getPsycheMiningPoolProgramId()
    if (!programId) {
      throw new Error(
        'PSYCHE_MINING_POOL_PROGRAM_ID env var required to use Psyche integration',
      )
    }
    _miningPoolProgramId = new PublicKey(programId)
  }
  return _miningPoolProgramId
}

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

// Borsh Schema for Solana Instructions

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

// Psyche Client

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

  // Run Management

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
      getCoordinatorProgramId(),
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
        programId: getCoordinatorProgramId(),
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
      getCoordinatorProgramId(),
    )

    const accountInfo =
      await this.connection.getAccountInfo(coordinatorInstance)
    if (!accountInfo) {
      return null
    }

    const data = accountInfo.data

    // Account layout:
    // 0-8: discriminator
    // 8-16: run state header
    // 16+: config fields
    const stateOffset = 16
    const configEnd = stateOffset + 40

    // Parse variable-length strings after config
    // Format: [u32 len][bytes...]
    let offset = configEnd

    const readString = (): string => {
      if (offset + 4 > data.length) return ''
      const len = data.readUInt32LE(offset)
      offset += 4
      if (offset + len > data.length) return ''
      const str = data.subarray(offset, offset + len).toString('utf8')
      offset += len
      return str
    }

    const name = readString()
    const description = readString()
    const modelHubRepo = readString()
    const datasetHubRepo = readString()
    const modelRevision = readString()
    const modelSha256 = readString()

    // Parse progress state (u8 enum + data)
    const progressType = offset < data.length ? data.readUInt8(offset) : 0
    offset += 1

    let progress: CoordinatorProgress
    switch (progressType) {
      case 1:
        progress = {
          type: 'WarmingUp',
          epoch: offset + 4 <= data.length ? data.readUInt32LE(offset) : 0,
        }
        break
      case 2:
        progress = {
          type: 'Training',
          epoch: offset + 4 <= data.length ? data.readUInt32LE(offset) : 0,
          step:
            offset + 12 <= data.length
              ? Number(data.readBigUInt64LE(offset + 4))
              : 0,
        }
        break
      case 3:
        progress = {
          type: 'Checkpointing',
          epoch: offset + 4 <= data.length ? data.readUInt32LE(offset) : 0,
        }
        break
      case 4:
        progress = {
          type: 'Paused',
          lastEpoch: offset + 4 <= data.length ? data.readUInt32LE(offset) : 0,
        }
        break
      case 5:
        progress = { type: 'Finished' }
        break
      default:
        progress = { type: 'Uninitialized' }
    }

    return {
      runId,
      metadata: {
        name: name || runId,
        description,
        modelHubRepo,
        datasetHubRepo,
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
        hubRepo: modelHubRepo,
        revision: modelRevision,
        sha256: modelSha256,
      },
      progress,
      clients: [], // Clients are in a separate PDA
      currentEpoch:
        progress.type === 'Training' || progress.type === 'WarmingUp'
          ? progress.epoch
          : 0,
      totalSteps: progress.type === 'Training' ? progress.step : 0,
      paused: progress.type === 'Paused',
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
      getCoordinatorProgramId(),
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
        programId: getCoordinatorProgramId(),
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
      getCoordinatorProgramId(),
    )

    const instruction = new TickInstruction()
    const data = borsh.serialize({ struct: { instruction: 'u8' } }, instruction)

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: getCoordinatorProgramId(),
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
      getCoordinatorProgramId(),
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
        programId: getCoordinatorProgramId(),
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
      getCoordinatorProgramId(),
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
        programId: getCoordinatorProgramId(),
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
      getCoordinatorProgramId(),
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
        programId: getCoordinatorProgramId(),
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

  // Mining Pool Integration

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
      getMiningPoolProgramId(),
    )

    const data = Buffer.alloc(1 + 32 + 8)
    data.writeUInt8(0, 0)
    Buffer.from(poolId.slice(0, 32)).copy(data, 1)
    data.writeBigUInt64LE(BigInt(epochDurationMs), 33)

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: getMiningPoolProgramId(),
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
      getMiningPoolProgramId(),
    )

    const [lenderPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('lender'),
        Buffer.from(poolId.slice(0, 32)),
        this.solanaKeypair.publicKey.toBuffer(),
      ],
      getMiningPoolProgramId(),
    )

    const data = Buffer.alloc(1 + 8)
    data.writeUInt8(1, 0)
    data.writeBigUInt64LE(amount, 1)

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: getMiningPoolProgramId(),
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
      getMiningPoolProgramId(),
    )

    const [lenderPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('lender'),
        Buffer.from(poolId.slice(0, 32)),
        this.solanaKeypair.publicKey.toBuffer(),
      ],
      getMiningPoolProgramId(),
    )

    const data = Buffer.alloc(1)
    data.writeUInt8(2, 0)

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: getMiningPoolProgramId(),
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

  // Cross-Chain Bridge to Jeju EVM

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
      chain: foundry,
      account: this.evmAccount,
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

  // Utilities

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

// Factory

export function createPsycheClient(config: PsycheConfig): PsycheClient {
  return new PsycheClient(config)
}
